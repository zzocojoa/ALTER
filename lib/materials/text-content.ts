import { materialFailure } from "./policy";
import type { MaterialMetadata } from "./policy";
import { transferMaterialBytes } from "./stream";
import type { MaterialStreamProof } from "./stream";

export type TextContentProof = Readonly<{ kind: "text"; encoding: "utf-8"; pages: 1; transfer: MaterialStreamProof }>;

/** 청크 사이의 UTF-8 상태를 유지하며 바이너리 제어 문자와 손상 인코딩을 거부합니다. HTML 같은 문자열은 원문이며 실행 가능한 콘텐츠로 취급하지 않습니다. */
function requireTextChunk(decoder: TextDecoder, chunk: Uint8Array): void {
  let text: string;
  try { text = decoder.decode(chunk, { stream: true }); }
  catch (error: unknown) {
    if (error instanceof TypeError) throw Object.assign(materialFailure("material_content_invalid", "utf-8", 422), { cause: error });
    throw error;
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw materialFailure("material_content_invalid", "text-control-character", 422);
}

/** 원문을 누적하지 않고 텍스트 인코딩·크기·해시를 같은 스트림에서 검증합니다. */
export async function validateTextContent(source: ReadableStream<Uint8Array>, metadata: MaterialMetadata, signal: AbortSignal): Promise<TextContentProof> {
  if (metadata.kind !== "text") throw materialFailure("material_type_mismatch", "text-validator-kind", 415);
  const decoder: TextDecoder = new TextDecoder("utf-8", { fatal: true });
  const destination: WritableStream<Uint8Array> = new WritableStream({
    write(chunk: Uint8Array): void { requireTextChunk(decoder, chunk); },
    close(): void {
      try { decoder.decode(); }
      catch (error: unknown) {
        if (error instanceof TypeError) throw Object.assign(materialFailure("material_content_invalid", "truncated-utf-8", 422), { cause: error });
        throw error;
      }
    },
  });
  const transfer: MaterialStreamProof = await transferMaterialBytes(source, destination, metadata, signal);
  return { kind: "text", encoding: "utf-8", pages: 1, transfer };
}
