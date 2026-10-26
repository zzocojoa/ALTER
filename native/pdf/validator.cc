#include <algorithm>
#include <array>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <exception>
#include <memory>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>
#include <emscripten.h>
#include <qpdf/InputSource.hh>
#include <qpdf/Pipeline.hh>
#include <qpdf/QPDF.hh>
#include <qpdf/QPDFObjectHandle.hh>
#include <qpdf/QPDFPageObjectHelper.hh>
#include <qpdf/global.hh>

EM_ASYNC_JS(int, alter_pdf_read, (int offset, int length, char* target), {
    try {
        const bytes = await Module.readRange(offset, length);
        if (!(bytes instanceof Uint8Array) || bytes.byteLength !== length) {
            throw new Error("pdf:range-length-mismatch");
        }
        HEAPU8.set(bytes, target);
        return length;
    } catch (error) {
        Module.rangeFailure(error);
        return -1;
    }
});
EM_JS(void, alter_pdf_complete, (int pages, int objects, int streams, int decoded, int reads, int bytes, int encoded_images), {
    Module.complete({pages, objects, streams, processedStreamBytes: decoded, rangeReads: reads, rangeBytes: bytes, encodedImageStreams: encoded_images});
});
EM_JS(void, alter_pdf_failure, (const char* message), { Module.failure(UTF8ToString(message)); });

namespace {
constexpr size_t window_bytes = 65536;
constexpr uint64_t max_read_bytes = 134217728;
constexpr uint64_t max_decoded_bytes = 134217728;
constexpr uint64_t max_image_sample_bytes = 1073741824;
constexpr uint64_t max_regular_flate_bytes = 16777216;

/** QPDF 외부 입력 연결은 한 개의 64KiB 창만 보관합니다. */
class RangeInput final: public InputSource {
  public:
    explicit RangeInput(qpdf_offset_t size): size_(size) {}
    std::string const& getName() const override { return name_; }
    qpdf_offset_t tell() override { return position_; }
    void rewind() override { seek(0, SEEK_SET); }
    void unreadCh(char) override { seek(-1, SEEK_CUR); }
    void seek(qpdf_offset_t offset, int whence) override {
        const qpdf_offset_t base = whence == SEEK_SET ? 0 : whence == SEEK_CUR ? position_ : whence == SEEK_END ? size_ : -1;
        if (base < 0 || offset < -base || offset > size_ - base) throw std::runtime_error("pdf:seek-out-of-range");
        position_ = base + offset;
        if (++seeks_ > 1000000) throw std::runtime_error("pdf:seek-budget");
    }
    size_t read(char* target, size_t length) override {
        last_offset = position_;
        const size_t total = std::min(length, static_cast<size_t>(size_ - position_));
        size_t done = 0;
        while (done < total) {
            if (position_ < window_start_ || position_ >= window_start_ + static_cast<qpdf_offset_t>(window_size_)) {
                window_start_ = position_ - position_ % window_bytes;
                window_size_ = std::min(window_bytes, static_cast<size_t>(size_ - window_start_));
                bytes_ += window_size_;
                if (++reads_ > 4096 || bytes_ > max_read_bytes) throw std::runtime_error("pdf:range-budget");
                if (alter_pdf_read(static_cast<int>(window_start_), static_cast<int>(window_size_), window_.data()) < 0) throw std::runtime_error("pdf:range-read-failed");
            }
            const size_t offset = static_cast<size_t>(position_ - window_start_);
            const size_t count = std::min(total - done, window_size_ - offset);
            std::memcpy(target + done, window_.data() + offset, count);
            done += count;
            position_ += count;
        }
        return total;
    }
    qpdf_offset_t findAndSkipNextEOL() override {
        char value = 0;
        while (read(&value, 1) != 0) {
            if (value != '\r' && value != '\n') continue;
            const qpdf_offset_t found = position_ - 1;
            while (read(&value, 1) != 0) {
                if (value != '\r' && value != '\n') { unreadCh(value); break; }
            }
            return found;
        }
        return size_;
    }
    int reads() const { return reads_; }
    int bytes() const { return static_cast<int>(bytes_); }
  private:
    const std::string name_{"ALTER PDF"};
    const qpdf_offset_t size_;
    qpdf_offset_t position_{0};
    qpdf_offset_t window_start_{-1};
    size_t window_size_{0};
    std::array<char, window_bytes> window_{};
    int reads_{0};
    uint64_t bytes_{0};
    unsigned int seeks_{0};
};

/** 디코더 출력 연결은 데이터를 저장하지 않고 크기 상한만 확인합니다. */
class BoundedDiscard final: public Pipeline {
  public:
    explicit BoundedDiscard(uint64_t limit): Pipeline("ALTER bounded decoded stream", nullptr), limit_(limit) {}
    void write(unsigned char const*, size_t length) override {
        if (length > limit_ - bytes_) throw std::runtime_error("pdf:decoded-byte-budget");
        bytes_ += length;
    }
    void finish() override {}
    int bytes() const { return static_cast<int>(bytes_); }
  private:
    const uint64_t limit_;
    uint64_t bytes_{0};
};

/** 예측 필터 없는 Flate 영상의 표본 길이를 구해 전체 영상 버퍼 없이 검증합니다. */
uint64_t flateImageSampleBytes(QPDFObjectHandle dictionary, QPDFObjectHandle filter) {
    if (!dictionary.getKey("/Subtype").isNameAndEquals("/Image") ||
        !filter.isNameAndEquals("/FlateDecode") || !dictionary.getKey("/DecodeParms").isNull()) return 0;
    const QPDFObjectHandle color = dictionary.getKey("/ColorSpace");
    int components = 0;
    if (color.isNameAndEquals("/DeviceGray")) components = 1;
    else if (color.isNameAndEquals("/DeviceRGB")) components = 3;
    else if (color.isNameAndEquals("/DeviceCMYK")) components = 4;
    else if (color.isArray() && color.getArrayNItems() == 2 && color.getArrayItem(0).isNameAndEquals("/ICCBased") && color.getArrayItem(1).isStream()) {
        const QPDFObjectHandle count = color.getArrayItem(1).getDict().getKey("/N");
        if (!count.isInteger() || (count.getIntValue() != 1 && count.getIntValue() != 3 && count.getIntValue() != 4)) throw std::runtime_error("pdf:embedded-image-components");
        components = static_cast<int>(count.getIntValue());
    }
    // 그 밖의 색 공간·예측 필터는 기존 일반 스트림 상한을 유지합니다.
    if (components == 0) return 0;
    const QPDFObjectHandle width = dictionary.getKey("/Width");
    const QPDFObjectHandle height = dictionary.getKey("/Height");
    const QPDFObjectHandle bits = dictionary.getKey("/BitsPerComponent");
    if (!width.isInteger() || !height.isInteger() || width.getIntValue() < 1 || height.getIntValue() < 1 || width.getIntValue() > 16000000 / height.getIntValue()) throw std::runtime_error("pdf:embedded-image-dimensions");
    if (!bits.isInteger() || (bits.getIntValue() != 1 && bits.getIntValue() != 2 && bits.getIntValue() != 4 && bits.getIntValue() != 8 && bits.getIntValue() != 16)) throw std::runtime_error("pdf:embedded-image-bit-depth");
    const uint64_t row_bytes = (static_cast<uint64_t>(width.getIntValue()) * components * bits.getIntValue() + 7) / 8;
    return row_bytes * static_cast<uint64_t>(height.getIntValue());
}

struct TreeProof { std::set<QPDFObjGen> visited; std::vector<QPDFObjectHandle> pages; };
TreeProof walkPages(QPDFObjectHandle node, QPDFObjectHandle parent, unsigned int depth, TreeProof proof) {
    if (depth > 32 || !node.isIndirect() || !node.isDictionary()) throw std::runtime_error("pdf:page-tree-node");
    if (!proof.visited.insert(node.getObjGen()).second || proof.visited.size() > 2048) throw std::runtime_error("pdf:page-tree-cycle-or-reuse");
    QPDFObjectHandle actual_parent = node.getKey("/Parent");
    if (parent.isNull() ? !actual_parent.isNull() : !actual_parent.isSameObjectAs(parent)) throw std::runtime_error("pdf:page-tree-parent");
    const QPDFObjectHandle type = node.getKey("/Type");
    if (type.isNameAndEquals("/Page")) {
        if (!node.getKey("/Kids").isNull()) throw std::runtime_error("pdf:page-has-kids");
        proof.pages.push_back(node);
        if (proof.pages.size() > 500) throw std::runtime_error("pdf:page-limit");
        return proof;
    }
    if (!type.isNameAndEquals("/Pages")) throw std::runtime_error("pdf:page-tree-type");
    QPDFObjectHandle kids = node.getKey("/Kids");
    QPDFObjectHandle count = node.getKey("/Count");
    if (!kids.isArray() || kids.getArrayNItems() < 1 || kids.getArrayNItems() > 500 || !count.isInteger() || count.getIntValue() < 1 || count.getIntValue() > 500) throw std::runtime_error("pdf:page-tree-count");
    const size_t before = proof.pages.size();
    for (int i = 0; i < kids.getArrayNItems(); ++i) proof = walkPages(kids.getArrayItem(i), node, depth + 1, std::move(proof));
    if (proof.pages.size() - before != static_cast<size_t>(count.getIntValue())) throw std::runtime_error("pdf:page-tree-count-mismatch");
    return proof;
}
void requireNoWarnings(QPDF& document) {
    if (document.anyWarnings()) throw std::runtime_error("pdf:parser-warning: " + std::string(document.getWarnings().front().what()));
}
void configureLimits() {
    qpdf::global::options::dct_throw_on_corrupt_data(true);
    qpdf::global::limits::parser_max_nesting(32);
    qpdf::global::limits::parser_max_errors(1);
    qpdf::global::limits::parser_max_container_size(10000);
    qpdf::global::limits::parser_max_container_size_damaged(10000);
    qpdf::global::limits::max_stream_filters(4);
    qpdf::global::limits::flate_max_memory(16777216);
    qpdf::global::limits::dct_max_memory(50331648);
    qpdf::global::limits::dct_max_progressive_scans(128);
    qpdf::global::limits::png_max_memory(1048576);
    qpdf::global::limits::tiff_max_memory(1048576);
    qpdf::global::limits::run_length_max_memory(16777216);
}
}

extern "C" EMSCRIPTEN_KEEPALIVE int alter_pdf_validate(int size) {
    try {
        if (size < 8 || size > 20971520) throw std::runtime_error("pdf:file-size");
        configureLimits();
        const std::shared_ptr<RangeInput> source = std::make_shared<RangeInput>(size);
        QPDF document;
        document.setAttemptRecovery(false);
        document.setSuppressWarnings(true);
        document.setMaxWarnings(1);
        document.processInputSource(source, nullptr);
        if (document.isEncrypted()) throw std::runtime_error("pdf:encrypted-unsupported");
        if (document.getXRefTable().size() > 10000) throw std::runtime_error("pdf:object-limit");
        requireNoWarnings(document);
        QPDFObjectHandle root = document.getRoot();
        if (!root.getKey("/Type").isNameAndEquals("/Catalog")) throw std::runtime_error("pdf:catalog-type");
        TreeProof tree = walkPages(root.getKey("/Pages"), QPDFObjectHandle::newNull(), 0, TreeProof{});
        requireNoWarnings(document);
        const std::vector<QPDFObjectHandle> objects = document.getAllObjects();
        uint64_t ordinary_bytes = 0;
        uint64_t image_sample_bytes = 0;
        int streams = 0;
        int encoded_images = 0;
        for (QPDFObjectHandle object: objects) {
            requireNoWarnings(document);
            if (!object.isStream()) continue;
            ++streams;
            QPDFObjectHandle length = object.getDict().getKey("/Length");
            if (!length.isInteger() || length.getIntValue() < 0 || length.getIntValue() > size) throw std::runtime_error("pdf:stream-length");
            QPDFObjectHandle filter = object.getDict().getKey("/Filter");
            QPDFObjectHandle image_filter = filter.isArray() && filter.getArrayNItems() == 1 ? filter.getArrayItem(0) : filter;
            const bool encoded_image = object.getDict().getKey("/Subtype").isNameAndEquals("/Image") &&
                (image_filter.isNameAndEquals("/DCTDecode") || image_filter.isNameAndEquals("/JPXDecode") ||
                 image_filter.isNameAndEquals("/CCITTFaxDecode") || image_filter.isNameAndEquals("/JBIG2Decode"));
            // 내장 이미지 압축은 구조와 길이를 확인하며 픽셀 디코딩 증거로 기록하지 않습니다.
            const uint64_t expected_samples = flateImageSampleBytes(object.getDict(), image_filter);
            if (expected_samples > max_image_sample_bytes - image_sample_bytes) throw std::runtime_error("pdf:image-sample-budget");
            BoundedDiscard sink(expected_samples > 0 ? expected_samples : max_decoded_bytes - ordinary_bytes);
            qpdf::global::limits::flate_max_memory(expected_samples > 0 ? expected_samples : max_regular_flate_bytes);
            bool filtered = false;
            if (!object.pipeStreamData(&sink, &filtered, 0, encoded_image ? qpdf_dl_none : qpdf_dl_specialized, false, false)) throw std::runtime_error("pdf:stream-decode-failed");
            qpdf::global::limits::flate_max_memory(max_regular_flate_bytes);
            if (!filter.isNull() && !filtered && !encoded_image) throw std::runtime_error("pdf:unsupported-stream-filter");
            if (expected_samples > 0) {
                if (static_cast<uint64_t>(sink.bytes()) != expected_samples) throw std::runtime_error("pdf:embedded-image-sample-length");
                image_sample_bytes += expected_samples;
            } else ordinary_bytes += sink.bytes();
            if (encoded_image) {
                QPDFObjectHandle width = object.getDict().getKey("/Width");
                QPDFObjectHandle height = object.getDict().getKey("/Height");
                if (!width.isInteger() || !height.isInteger() || width.getIntValue() < 1 || height.getIntValue() < 1 || width.getIntValue() > 16000000 / height.getIntValue() || length.getIntValue() < 1) throw std::runtime_error("pdf:embedded-image-dimensions");
                ++encoded_images;
            }
            requireNoWarnings(document);
        }
        for (QPDFObjectHandle page: tree.pages) {
            QPDFPageObjectHelper helper(page);
            helper.parseContents(nullptr);
            requireNoWarnings(document);
        }
        alter_pdf_complete(static_cast<int>(tree.pages.size()), static_cast<int>(objects.size()), streams, static_cast<int>(ordinary_bytes + image_sample_bytes), source->reads(), source->bytes(), encoded_images);
        return 0;
    } catch (const std::exception& error) {
        alter_pdf_failure(error.what());
        return -1;
    }
}
