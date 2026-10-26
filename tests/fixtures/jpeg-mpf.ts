/** 합성 JPEG 두 장에 MPF 색인을 넣어 원본 사진 없이 컨테이너 회귀를 재현합니다. */
export function indexedJpeg(primary: Uint8Array, auxiliary: Uint8Array, byteOrder: "little" | "big"): Uint8Array {
  const little: boolean = byteOrder === "little";
  const segment: Uint8Array = new Uint8Array(90);
  segment.set([255, 226, 0, 88, 77, 80, 70, 0]);
  const tiff: Uint8Array = segment.subarray(8);
  const view: DataView = new DataView(tiff.buffer, tiff.byteOffset, tiff.length);
  tiff.set(little ? [73, 73] : [77, 77]); view.setUint16(2, 42, little); view.setUint32(4, 8, little); view.setUint16(8, 3, little);
  for (const [at, tag, type, count, value] of [[10, 0xb000, 7, 4, 0], [22, 0xb001, 4, 1, 2], [34, 0xb002, 7, 32, 50]]) {
    view.setUint16(at, tag, little); view.setUint16(at + 2, type, little); view.setUint32(at + 4, count, little); view.setUint32(at + 8, value, little);
  }
  tiff.set([48, 49, 48, 48], 18);
  view.setUint32(50, 0x030000, little); view.setUint32(54, primary.length + segment.length, little);
  view.setUint32(70, auxiliary.length, little); view.setUint32(74, primary.length + segment.length - 10, little);
  const result: Uint8Array = new Uint8Array(primary.length + segment.length + auxiliary.length);
  result.set(primary.subarray(0, 2)); result.set(segment, 2); result.set(primary.subarray(2), 92); result.set(auxiliary, primary.length + segment.length);
  return result;
}
