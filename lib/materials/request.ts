import { z } from "zod";
import { recordId, version } from "../domain/contracts.ts";
import { materialFailure, materialMetadata, requireMaterialBodyLength, validateMaterialMetadata } from "./policy.ts";
import type { MaterialMetadata } from "./policy.ts";

export const materialStartInput = z.object({ courseId: recordId, metadata: materialMetadata }).strict();
export type MaterialStartInput = Readonly<z.infer<typeof materialStartInput>>;
export const materialActionInput = z.object({ expectedVersion: version }).strict();
export type MaterialActionInput = Readonly<z.infer<typeof materialActionInput>>;

/** 메타데이터 JSON만 16KiB까지 읽으며 원본 파일 본문과 혼합하지 않습니다. */
export async function readMaterialJson(request: Request): Promise<unknown> { return readBoundedJson(request, 16384); }

export type BoundedJsonDocument = Readonly<{ text: string; value: unknown }>;
/** 기존 JSON 호출자는 파싱한 값만 사용하며 원본 문서 해시가 필요한 호출자와 같은 크기 검사를 공유합니다. */
export async function readBoundedJson(request: Readonly<Pick<Request, "headers" | "body">>, maximumBytes: number): Promise<unknown> {
  return (await readBoundedJsonDocument(request, maximumBytes)).value;
}
/** 경로별 상한 안에서 UTF-8 원문을 보존합니다. 공백·이스케이프도 서명 대상 바이트에 포함됩니다. */
export async function readBoundedJsonDocument(request: Readonly<Pick<Request, "headers" | "body">>, maximumBytes: number): Promise<BoundedJsonDocument> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 8388608) throw new RangeError("JSON 본문 상한이 올바르지 않습니다.");
  if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "")) throw materialFailure("material_request_invalid", "content-type:application/json", 415);
  if (request.body === null) throw materialFailure("material_request_invalid", "json-body", 400);
  const declared: string | null = request.headers.get("content-length");
  if (declared !== null && (!/^[1-9]\d*$/.test(declared) || !Number.isSafeInteger(Number(declared)) || Number(declared) > maximumBytes)) throw materialFailure("material_request_invalid", "json-length", 413);
  const reader: ReadableStreamDefaultReader<Uint8Array> = request.body.getReader();
  const decoder: TextDecoder = new TextDecoder("utf-8", { fatal: true });
  let bytes: number = 0;
  let text: string = "";
  try {
    for (;;) {
      const part: ReadableStreamReadResult<Uint8Array> = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maximumBytes) { await reader.cancel("metadata-size-limit"); throw materialFailure("material_request_invalid", "json-length", 413); }
      try { text += decoder.decode(part.value, { stream: true }); }
      catch (error: unknown) { if (error instanceof TypeError) throw materialFailure("material_request_invalid", "json-utf8", 400); throw error; }
    }
    if (declared !== null && Number(declared) !== bytes) throw materialFailure("material_request_invalid", "json-length-mismatch", 400);
    try { text += decoder.decode(); return { text, value: JSON.parse(text) as unknown }; }
    catch (error: unknown) { if (error instanceof SyntaxError || error instanceof TypeError) throw materialFailure("material_request_invalid", "json-syntax-or-utf8", 400); throw error; }
  } finally { reader.releaseLock(); }
}

export function parseMaterialStart(value: unknown): MaterialStartInput {
  const input: MaterialStartInput = materialStartInput.parse(value);
  return { courseId: input.courseId, metadata: validateMaterialMetadata(input.metadata) };
}

export function materialRequestKey(headers: Headers): string {
  const parsed = recordId.safeParse(headers.get("idempotency-key"));
  if (!parsed.success) throw materialFailure("material_request_invalid", "idempotency-key:uuid", 400);
  return parsed.data;
}

/** 선언 MIME・길이를 이미 예약한 자료와 대조하고 실제 내용 검사는 스트림 검증에 맡깁니다. */
export function requireMaterialTransferBody(request: Readonly<Pick<Request, "headers" | "body">>, metadata: MaterialMetadata): void {
  if (request.headers.get("content-type") !== metadata.mime) throw materialFailure("material_type_mismatch", "content-type", 415);
  if (request.headers.get("content-encoding") !== null) throw materialFailure("material_request_invalid", "content-encoding", 415);
  if (request.body === null) throw materialFailure("material_body_length_invalid", "body", 400);
  requireMaterialBodyLength(request.headers.get("content-length"), metadata.bytes);
}
