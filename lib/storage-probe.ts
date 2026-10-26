import { requireStorageBindings } from "./storage-bindings";
import type { StorageBindings } from "./storage-bindings";

export type StorageProbeResult = Readonly<{ database: "passed"; files: "passed"; cleanup: "passed" }>;

/** 업무 테이블과 기존 파일을 건드리지 않고 별도 진단 객체를 읽고 정리합니다. */
async function probeOnce(bindings: StorageBindings, key: string): Promise<StorageProbeResult> {
  const { DB, BUCKET }: StorageBindings = requireStorageBindings(bindings);
  const result: number | null = await DB.prepare("SELECT 1 AS connected").first<number>("connected");
  if (result !== 1) throw new Error("D1 연결 검사 실패: SELECT 1의 결과가 일치하지 않습니다.");
  const payload: string = "ALTER storage connection check";
  try {
    await BUCKET.put(key, payload, { httpMetadata: { contentType: "text/plain" } });
    const object: R2ObjectBody | null = await BUCKET.get(key);
    if (!object || await object.text() !== payload) throw new Error("R2 연결 검사 실패: 진단 객체 조회 결과가 일치하지 않습니다.");
  } catch (operationError) {
    try {
      await BUCKET.delete(key);
    } catch (cleanupError) {
      throw new AggregateError([operationError, cleanupError], "R2 진단 작업과 정리가 함께 실패했습니다. 두 서비스 오류를 확인하세요.");
    }
    throw operationError;
  }
  await BUCKET.delete(key);
  if (await BUCKET.get(key) !== null) throw new Error("R2 연결 검사 실패: 진단 객체 정리를 확인하지 못했습니다.");
  return { database: "passed", files: "passed", cleanup: "passed" };
}

/** 재시도마다 같은 진단 키를 사용하고 마지막 오류를 그대로 전달합니다. */
export async function probeStorage(bindings: StorageBindings): Promise<StorageProbeResult> {
  const key: string = `diagnostics/${crypto.randomUUID()}`;
  for (let attempt: number = 1; attempt <= 3; attempt += 1) {
    try { return await probeOnce(bindings, key); } catch (error) {
      if (attempt === 3 || error instanceof TypeError) throw error;
      console.warn({ event: "storage_probe_retry", attempt, operation: "diagnostic_roundtrip", errorType: error instanceof Error ? error.name : "unknown" });
      await new Promise<void>((resolve) => setTimeout(resolve, attempt * 100));
    }
  }
  throw new Error("저장소 검사 재시도 횟수를 벗어났습니다.");
}
