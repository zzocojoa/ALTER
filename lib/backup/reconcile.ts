import { z } from "zod";
import type { SiteIdentity } from "../domain/contracts.ts";
import type { GoogleExecutionSettings } from "../google/execute.ts";
import type { GoogleRestRuntime } from "../google/rest-transport.ts";
import { readGoogleExternalOperation } from "../external/google-read.ts";
import { readGoogleExternalContract } from "../external/google-contract.ts";
import { verifyExternalContent } from "../external/verification.ts";
import { readExternalOperation } from "../../db/repositories/external-operation.ts";
import { finishRestoreReconciliation, requireRestoreRead, startRestoreReconciliation } from "../../db/repositories/restore-reconciliation.ts";
import { restoredGoogleObservationReader } from "./reconciliation-google.ts";
import { restoreReadProof } from "./reconciliation.ts";
import type { RestoreReconciliation, RestoreReconciliationInput, RestoreReadProof } from "./reconciliation.ts";

/** 명시적 조회만 수행하고 확인 결과는 원래 외부 작업과 독립된 영수증에 저장합니다. */
export async function reconcileRestoredOperation(db: D1Database, owner: SiteIdentity, input: RestoreReconciliationInput, settings: GoogleExecutionSettings, runtime: GoogleRestRuntime): Promise<RestoreReconciliation> {
  const started = await startRestoreReconciliation(db, owner, input, runtime.now()); if (!started.created) return started.row;
  let proof: RestoreReadProof;
  try {
    const operation = await readExternalOperation(db, owner, input.operationId);
    const reader = restoredGoogleObservationReader(db, owner, input.id, settings, runtime);
    const result = await readGoogleExternalOperation(reader, { operation, attemptId: crypto.randomUUID(), beforeCall: async () => { await requireRestoreRead(db, owner, input.id, runtime.now()); } });
    proof = operation.externalId === null ? { status: "unknown", reason: "missing-external-id", checkedAt: runtime.now() } : restoreReadProof.parse(await verifyExternalContent(readGoogleExternalContract(operation).expected, operation.externalId, result.observation, runtime.now()));
    await requireRestoreRead(db, owner, input.id, runtime.now());
  } catch (error: unknown) {
    const unavailable: RestoreReadProof = { status: "unknown", reason: error instanceof Error && "reason" in error && error.reason === "not-found" ? "not-found" : error instanceof z.ZodError ? "unsupported-content" : "request-failed", checkedAt: runtime.now() };
    try { await finishRestoreReconciliation(db, owner, input.id, unavailable, runtime.now()); }
    catch (storageError: unknown) { throw new AggregateError([error, storageError], "복원 대조와 오류 기록 저장에 실패했습니다. 대조 요청 ID로 저장 상태를 확인하세요."); }
    throw error;
  }
  return finishRestoreReconciliation(db, owner, input.id, proof, runtime.now());
}
