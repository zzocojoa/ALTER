#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <setjmp.h>
#include <emscripten/emscripten.h>
#include <jpeglib.h>
#include <jerror.h>
#include <jpegint.h>

#define WINDOW_BYTES 65536
#define ROW_BYTES 262144
#define MAX_PIXELS 16000000
#define MAX_COEFFICIENT_BYTES 50331648

typedef struct {
  struct jpeg_decompress_struct jpeg;
  struct jpeg_error_mgr error;
  struct jpeg_source_mgr source;
  struct jpeg_progress_mgr progress;
  unsigned int work_steps;
  jmp_buf jump;
  unsigned char window[WINDOW_BYTES];
  unsigned char incoming[WINDOW_BYTES];
  unsigned char row[ROW_BYTES];
  char message[JMSG_LENGTH_MAX];
  size_t pending_skip;
  size_t maximum_retained;
  size_t coefficient_bytes;
  unsigned int row_bytes;
  int created;
  int phase;
  int ended;
} AlterJpeg;

static void fatal(j_common_ptr common) {
  AlterJpeg *decoder = (AlterJpeg *)common->client_data;
  (*common->err->format_message)(common, decoder->message);
  longjmp(decoder->jump, 1);
}
static void emit(j_common_ptr common, int level) {
  if (level < 0) fatal(common);
}
static void progress(j_common_ptr common) {
  AlterJpeg *decoder = (AlterJpeg *)common->client_data;
  decoder->work_steps++;
  if (decoder->jpeg.input_scan_number > 128 || decoder->work_steps > 2000000) {
    snprintf(decoder->message, sizeof(decoder->message), "decode-work-limit");
    longjmp(decoder->jump, 1);
  }
}
static void init_source(j_decompress_ptr jpeg) { (void)jpeg; }
static void term_source(j_decompress_ptr jpeg) { (void)jpeg; }

/** EOF에 가짜 EOI를 삽입하지 않고 읽기를 중단하거나 명시적 오류를 냅니다. */
static boolean refill(j_decompress_ptr jpeg) {
  AlterJpeg *decoder = (AlterJpeg *)jpeg->client_data;
  if (decoder->ended) ERREXIT(jpeg, JERR_INPUT_EOF);
  return FALSE;
}
static void skip(j_decompress_ptr jpeg, long count) {
  AlterJpeg *decoder = (AlterJpeg *)jpeg->client_data;
  if (count <= 0) return;
  size_t used = (size_t)count < decoder->source.bytes_in_buffer ? (size_t)count : decoder->source.bytes_in_buffer;
  decoder->source.next_input_byte += used;
  decoder->source.bytes_in_buffer -= used;
  decoder->pending_skip += (size_t)count - used;
}
static int fail(AlterJpeg *decoder, const char *message) {
  snprintf(decoder->message, sizeof(decoder->message), "%s", message);
  return -1;
}

EMSCRIPTEN_KEEPALIVE AlterJpeg *alter_jpeg_create(void) {
  AlterJpeg *decoder = (AlterJpeg *)calloc(1, sizeof(AlterJpeg));
  if (!decoder) return NULL;
  decoder->jpeg.err = jpeg_std_error(&decoder->error);
  decoder->error.error_exit = fatal;
  decoder->error.emit_message = emit;
  decoder->jpeg.client_data = decoder;
  if (setjmp(decoder->jump)) { jpeg_destroy_decompress(&decoder->jpeg); free(decoder); return NULL; }
  jpeg_create_decompress(&decoder->jpeg);
  decoder->created = 1;
  decoder->progress.progress_monitor = progress;
  decoder->jpeg.progress = &decoder->progress;
  decoder->jpeg.mem->max_memory_to_use = MAX_COEFFICIENT_BYTES;
  decoder->source.init_source = init_source;
  decoder->source.fill_input_buffer = refill;
  decoder->source.skip_input_data = skip;
  decoder->source.resync_to_restart = jpeg_resync_to_restart;
  decoder->source.term_source = term_source;
  decoder->source.next_input_byte = decoder->window;
  decoder->jpeg.src = &decoder->source;
  return decoder;
}
EMSCRIPTEN_KEEPALIVE unsigned char *alter_jpeg_incoming(AlterJpeg *decoder) { return decoder->incoming; }
EMSCRIPTEN_KEEPALIVE unsigned char *alter_jpeg_row(AlterJpeg *decoder) { return decoder->row; }
EMSCRIPTEN_KEEPALIVE const char *alter_jpeg_error(AlterJpeg *decoder) { return decoder->message; }
EMSCRIPTEN_KEEPALIVE unsigned int alter_jpeg_width(AlterJpeg *decoder) { return decoder->jpeg.image_width; }
EMSCRIPTEN_KEEPALIVE unsigned int alter_jpeg_height(AlterJpeg *decoder) { return decoder->jpeg.image_height; }
EMSCRIPTEN_KEEPALIVE unsigned int alter_jpeg_row_bytes(AlterJpeg *decoder) { return decoder->row_bytes; }
EMSCRIPTEN_KEEPALIVE unsigned int alter_jpeg_rows(AlterJpeg *decoder) { return decoder->jpeg.output_scanline; }
EMSCRIPTEN_KEEPALIVE unsigned int alter_jpeg_retained(AlterJpeg *decoder) { return decoder->maximum_retained; }
EMSCRIPTEN_KEEPALIVE unsigned int alter_jpeg_coefficients(AlterJpeg *decoder) { return decoder->coefficient_bytes; }
EMSCRIPTEN_KEEPALIVE unsigned int alter_jpeg_progressive(AlterJpeg *decoder) { return decoder->jpeg.progressive_mode; }
EMSCRIPTEN_KEEPALIVE unsigned int alter_jpeg_space(AlterJpeg *decoder) { return WINDOW_BYTES - decoder->source.bytes_in_buffer; }

/** 중단된 API의 재시작 위치 뒤 바이트만 보존하고 다음 입력을 붙입니다. */
EMSCRIPTEN_KEEPALIVE int alter_jpeg_feed(AlterJpeg *decoder, unsigned int length) {
  if (decoder->ended || length > WINDOW_BYTES - decoder->source.bytes_in_buffer) return fail(decoder, "input-window-limit");
  size_t dropped = length < decoder->pending_skip ? length : decoder->pending_skip;
  decoder->pending_skip -= dropped;
  size_t retained = decoder->source.bytes_in_buffer;
  memmove(decoder->window, decoder->source.next_input_byte, retained);
  memcpy(decoder->window + retained, decoder->incoming + dropped, length - dropped);
  decoder->source.next_input_byte = decoder->window;
  decoder->source.bytes_in_buffer = retained + length - dropped;
  if (decoder->source.bytes_in_buffer > decoder->maximum_retained) decoder->maximum_retained = decoder->source.bytes_in_buffer;
  return 0;
}
EMSCRIPTEN_KEEPALIVE int alter_jpeg_end(AlterJpeg *decoder) {
  decoder->ended = 1;
  if (decoder->pending_skip != 0) return fail(decoder, "unexpected-eof");
  return 0;
}

/** 0=추가 입력, 1=한 행 완료, 2=EOI 완료, -1=오류. 출력은 항상 원래 크기입니다. */
EMSCRIPTEN_KEEPALIVE int alter_jpeg_step(AlterJpeg *decoder) {
  if (setjmp(decoder->jump)) return -1;
  if (decoder->phase == 0) {
    int result = jpeg_read_header(&decoder->jpeg, TRUE);
    if (result == JPEG_SUSPENDED) return 0;
    uint64_t pixels = (uint64_t)decoder->jpeg.image_width * decoder->jpeg.image_height;
    if (!pixels || pixels > MAX_PIXELS) return fail(decoder, "pixel-limit");
    if (decoder->jpeg.arith_code) return fail(decoder, "unsupported-arithmetic-coding");
    if (decoder->jpeg.data_precision != 8 || decoder->jpeg.master->lossless) return fail(decoder, "unsupported-precision-or-lossless");
    if (decoder->jpeg.num_components != 1 && decoder->jpeg.num_components != 3 && decoder->jpeg.num_components != 4) return fail(decoder, "components");
    decoder->jpeg.out_color_space = decoder->jpeg.num_components == 1 ? JCS_GRAYSCALE : decoder->jpeg.num_components == 4 ? JCS_CMYK : JCS_RGB;
    decoder->jpeg.do_fancy_upsampling = FALSE;
    decoder->jpeg.do_block_smoothing = FALSE;
    decoder->row_bytes = decoder->jpeg.image_width * decoder->jpeg.num_components;
    if (decoder->row_bytes > ROW_BYTES) return fail(decoder, "row-memory-limit");
    if (jpeg_has_multiple_scans(&decoder->jpeg)) {
      uint64_t bytes = 0;
      for (int i = 0; i < decoder->jpeg.num_components; i++) {
        jpeg_component_info *component = &decoder->jpeg.comp_info[i];
        uint64_t columns = ((uint64_t)component->width_in_blocks + component->h_samp_factor - 1) / component->h_samp_factor * component->h_samp_factor;
        uint64_t rows = ((uint64_t)component->height_in_blocks + component->v_samp_factor - 1) / component->v_samp_factor * component->v_samp_factor;
        bytes += columns * rows * sizeof(JBLOCK);
      }
      if (bytes > MAX_COEFFICIENT_BYTES) return fail(decoder, "coefficient-memory-limit");
      decoder->coefficient_bytes = (size_t)bytes;
    }
    decoder->phase = 1;
  }
  if (decoder->phase == 1) {
    if (!jpeg_start_decompress(&decoder->jpeg)) return 0;
    decoder->phase = 2;
  }
  if (decoder->phase == 2) {
    if (decoder->jpeg.output_scanline < decoder->jpeg.output_height) {
      JSAMPROW row = decoder->row;
      if (jpeg_read_scanlines(&decoder->jpeg, &row, 1) == 0) return 0;
      return 1;
    }
    decoder->phase = 3;
  }
  if (decoder->phase == 3) {
    if (!jpeg_finish_decompress(&decoder->jpeg)) return 0;
    decoder->phase = 4;
  }
  if (decoder->source.bytes_in_buffer != 0) return fail(decoder, "trailing-bytes");
  return 2;
}
EMSCRIPTEN_KEEPALIVE void alter_jpeg_destroy(AlterJpeg *decoder) {
  if (decoder->created) jpeg_destroy_decompress(&decoder->jpeg);
  free(decoder);
}
