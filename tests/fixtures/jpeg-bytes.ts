/** 작은 이미지에 APP15 패딩을 더해 여러 청크를 건너뛰는 입력을 검증합니다. */
export function paddedJpeg(bytes: Uint8Array, size: number): Buffer {
  const chunks: Buffer[] = [Buffer.from(bytes.subarray(0, 2))];
  let remaining: number = size - bytes.byteLength;
  while (remaining > 0) {
    let length: number = Math.min(65537, remaining);
    if (remaining > length && remaining - length < 4) length -= 4;
    if (length < 4) throw new Error("JPEG 패딩 길이는 마커 헤더를 포함해야 합니다.");
    const marker: Buffer = Buffer.alloc(length); marker[0] = 255; marker[1] = 239; marker.writeUInt16BE(length - 2, 2);
    chunks.push(marker); remaining -= length;
  }
  return Buffer.concat([...chunks, Buffer.from(bytes.subarray(2))]);
}
