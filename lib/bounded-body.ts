/** 선언한 길이와 실제 스트림을 모두 확인해 큰 요청이 메모리에 쌓이지 않게 합니다. */
export async function readBoundedBody(body: ReadableStream<Uint8Array> | null, expectedLength: number, limit: number): Promise<ArrayBuffer> {
  if (!body || !Number.isSafeInteger(expectedLength) || expectedLength < 1 || expectedLength > limit) throw new RangeError("파일 크기가 허용 범위를 벗어났습니다.");
  const output: Uint8Array = new Uint8Array(expectedLength);
  const reader: ReadableStreamDefaultReader<Uint8Array> = body.getReader();
  let received: number = 0;
  try {
    while (true) {
      const chunk: ReadableStreamReadResult<Uint8Array> = await reader.read();
      if (chunk.done) break;
      if (received + chunk.value.byteLength > expectedLength) {
        await reader.cancel("파일 크기 초과");
        throw new RangeError("실제 파일 크기가 선언한 길이를 초과했습니다.");
      }
      output.set(chunk.value, received);
      received += chunk.value.byteLength;
    }
  } finally { reader.releaseLock(); }
  if (received !== expectedLength) throw new RangeError("실제 파일 크기가 선언한 길이와 다릅니다.");
  return output.buffer as ArrayBuffer;
}
