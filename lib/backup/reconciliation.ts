import { z } from "zod";
import { recordId, timestamp, version } from "../domain/contracts.ts";
import { externalVerification } from "../external/verification.ts";

export const restoreReconciliationInput = z.object({ id: recordId, operationId: recordId, expectedVersion: version }).strict();
export type RestoreReconciliationInput = Readonly<z.infer<typeof restoreReconciliationInput>>;
export const restoreReconciliationRow = z.object({ id: recordId, run_id: recordId, owner_id: z.string().min(1), operation_id: recordId, operation_version: version, connection_id: recordId, generation: version, started_at: timestamp, expires_at: timestamp, finished_at: timestamp.nullable(), proof: z.string().nullable() }).strict();
export type RestoreReconciliation = Readonly<z.infer<typeof restoreReconciliationRow>>;
export const restoreReadProof = externalVerification.refine(value => value.status !== "not-executed", "복원 조회는 미실행 증명이나 재실행 권한을 만들지 않습니다.");
export type RestoreReadProof = Readonly<z.infer<typeof restoreReadProof>>;
export function restoreReconciliationView(row: RestoreReconciliation): Readonly<{ id: string; operationId: string; startedAt: number; finishedAt: number | null; result: RestoreReadProof | null; executionAllowed: false }> {
  return { id: row.id, operationId: row.operation_id, startedAt: row.started_at, finishedAt: row.finished_at, result: row.proof === null ? null : restoreReadProof.parse(JSON.parse(row.proof)), executionAllowed: false };
}
