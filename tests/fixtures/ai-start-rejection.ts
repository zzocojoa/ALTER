import { domainFailure } from "../../lib/domain/contracts.ts";
import type { Command, FailureCode } from "../../lib/domain/contracts.ts";
import { rejectAiStart } from "../../db/repositories/ai-start-rejection.ts";
import { matchesAiStartRejection } from "../../lib/tutor/ai-start-rejection.ts";
import type { AiStartAction } from "../../lib/tutor/ai-start-rejection.ts";

export async function expectAiNotStarted(run: () => Promise<unknown>, cmd: Command, id: string, action: AiStartAction): Promise<void> {
  try { await run(); }
  catch (error: unknown) {
    if (error instanceof Error && "aiStartRejection" in error && matchesAiStartRejection(error.aiStartRejection, { key: cmd.requestKey, input: { id, expectedVersion: cmd.expectedVersion, action } })) return;
    throw error;
  }
  throw new Error("시작 전 확정 거부와 요청별 증거가 필요합니다.");
}

/** 이미 커밋된 같은 키와 저장 결과 불명은 시작하지 않았다고 판정하지 않습니다. */
export async function verifyAiStartAmbiguity(db: D1Database, committed: Command, id: string, action: AiStartAction): Promise<void> {
  const failures: readonly FailureCode[] = ["version_conflict", "reference_conflict", "validation", "limit_exceeded", "result_unknown", "storage_failure", "request_key_reused"];
  for (const code of failures) {
    const failure = domainFailure(code, "fixture.ai-start-rejection", null);
    try { await rejectAiStart(db, committed, id, action, failure); }
    catch (error: unknown) { if (error instanceof Error && error === failure && !("aiStartRejection" in error)) continue; throw error; }
    throw new Error("기존 시작 영수증은 복구 잠금을 유지해야 합니다.");
  }
  for (const code of ["result_unknown", "storage_failure", "request_key_reused"] as const) {
    const failure = domainFailure(code, "fixture.ai-start-rejection", null);
    try { await rejectAiStart(db, { ...committed, requestKey: crypto.randomUUID() }, id, action, failure); }
    catch (error: unknown) { if (error instanceof Error && error === failure && !("aiStartRejection" in error)) continue; throw error; }
    throw new Error("영수증 부재만으로 저장 결과 불명을 해제하면 안 됩니다.");
  }
}

/** 커밋은 완료했지만 응답이 유실된 저장소를 재현합니다. */
export function loseCommittedBatchResponse(db: D1Database): D1Database {
  return new Proxy(db, { get(target: D1Database, property: string | symbol): unknown {
    if (property === "batch") return async (statements: D1PreparedStatement[]): Promise<never> => { await target.batch(statements); throw new Error("network timeout after committed batch"); };
    const value: unknown = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}
