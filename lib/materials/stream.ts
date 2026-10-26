import { materialFailure, validateMaterialMetadata } from "./policy.ts";
import type { MaterialMetadata } from "./policy.ts";
import { createCheckedByteStream } from "./checked-stream.ts";
import type { CheckedStreamProof } from "./checked-stream.ts";

/** 읽기 버퍼의 실측이며 전체 격리 환경의 메모리나 저장소 등록 완료를 보증하지 않습니다. */
export type MaterialStreamProof = CheckedStreamProof;

/** 원본 등록과 백업이 같은 제한 버퍼·증분 해시 검증을 재사용합니다. */
export async function transferMaterialBytes(source: ReadableStream<Uint8Array>, destination: WritableStream<Uint8Array>, metadata: MaterialMetadata, signal: AbortSignal): Promise<MaterialStreamProof> {
  let proof: MaterialStreamProof | null = null;
  let checked: ReadableStream<Uint8Array>;
  try {
    const expected: MaterialMetadata = validateMaterialMetadata(metadata);
    checked = createCheckedByteStream(source, expected, signal, async (result: CheckedStreamProof): Promise<void> => { proof = result; });
  } catch (error: unknown) {
    try { await destination.abort(error); } catch (cleanupError: unknown) { if (cleanupError !== error) throw new AggregateError([error, cleanupError], "자료 전송 준비 실패 후 출력 스트림 정리도 실패했습니다."); }
    throw error;
  }
  await checked.pipeTo(destination, { signal });
  if (proof === null) throw materialFailure("material_body_length_invalid", "incomplete-stream", 400);
  return proof;
}
