import { materialFailure } from "./policy";

export type JpegMpf = Readonly<{ primaryBytes: number; auxiliaryOffset: number; auxiliaryBytes: number }>;
function invalid(field: string): Error { return materialFailure("material_content_invalid", `jpeg:mpf-${field}`, 422); }

/** MPF의 JPEG 두 장만 허용하고 모든 크기·오프셋은 실제 디코딩 경계와 별도로 대조합니다. */
export function parseJpegMpf(payload: Uint8Array, tiffBase: number): JpegMpf | null {
  if (payload.length < 4 || payload[0] !== 77 || payload[1] !== 80 || payload[2] !== 70 || payload[3] !== 0) return null;
  const tiff: Uint8Array = payload.subarray(4);
  const view: DataView = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  if (tiff.length < 8) throw invalid("header");
  const little: boolean = tiff[0] === 73 && tiff[1] === 73;
  if (!little && !(tiff[0] === 77 && tiff[1] === 77)) throw invalid("endian");
  if (view.getUint16(2, little) !== 42) throw invalid("tiff-version");
  const index: number = view.getUint32(4, little);
  if (index < 8 || index + 2 > tiff.length) throw invalid("index-offset");
  const count: number = view.getUint16(index, little);
  const end: number = index + 2 + count * 12 + 4;
  if (end > tiff.length) throw invalid("index-length");
  const tags: Map<number, number> = new Map();
  for (let i: number = 0; i < count; i += 1) {
    const at: number = index + 2 + i * 12;
    const tag: number = view.getUint16(at, little);
    if (tags.has(tag)) throw invalid("duplicate-tag");
    tags.set(tag, at);
  }
  const version: number | undefined = tags.get(0xb000);
  const images: number | undefined = tags.get(0xb001);
  const entries: number | undefined = tags.get(0xb002);
  if (version === undefined || images === undefined || entries === undefined) throw invalid("required-tags");
  if (view.getUint16(version + 2, little) !== 7 || view.getUint32(version + 4, little) !== 4 || new TextDecoder().decode(tiff.subarray(version + 8, version + 12)) !== "0100") throw invalid("version");
  if (view.getUint16(images + 2, little) !== 4 || view.getUint32(images + 4, little) !== 1 || view.getUint32(images + 8, little) !== 2) throw invalid("image-count");
  if (view.getUint16(entries + 2, little) !== 7 || view.getUint32(entries + 4, little) !== 32) throw invalid("entries-type");
  const offset: number = view.getUint32(entries + 8, little);
  if (offset < end || offset + 32 > tiff.length) throw invalid("entries-offset");
  for (const at of [offset, offset + 16]) {
    const attributes: number = view.getUint32(at, little);
    if ((attributes & 0x1f000000) !== 0 || view.getUint16(at + 12, little) > 2 || view.getUint16(at + 14, little) > 2) throw invalid("entry-format");
  }
  if ((view.getUint32(offset, little) & 0xffffff) !== 0x030000 || view.getUint32(offset + 8, little) !== 0) throw invalid("primary-entry");
  const primaryBytes: number = view.getUint32(offset + 4, little);
  const auxiliaryBytes: number = view.getUint32(offset + 20, little);
  const auxiliaryOffset: number = tiffBase + view.getUint32(offset + 24, little);
  if (primaryBytes < 4 || auxiliaryBytes < 4 || auxiliaryOffset !== primaryBytes) throw invalid("noncontiguous-images");
  return { primaryBytes, auxiliaryOffset, auxiliaryBytes };
}
