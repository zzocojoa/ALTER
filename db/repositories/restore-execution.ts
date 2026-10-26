import type { RestoredExecution } from "../../lib/backup/restore-execution.ts";
import { z } from "zod";
import { recordId, siteIdentity, timestamp } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import { restoreStorageIdentity } from "../../lib/backup/restore-authority.ts";
import { readStorage } from "./atomic.ts";
import type { AtomicDatabase } from "./atomic.ts";

const stateRow = z.object({ identity: z.string(), storage_state: z.string(), run_id: recordId.nullable(), owner_id: z.string().nullable(), run_state: z.string().nullable(), activated_at: timestamp.nullable() }).strict();
/** 환경 설정을 지워도 저장된 복원 상태는 유지됩니다. 과거 원장은 새 실행 권한이 아닙니다. */
export async function readRestoredExecution(db: AtomicDatabase, owner: SiteIdentity): Promise<RestoredExecution | null> {
  siteIdentity.parse(owner);
  const value = await readStorage("restore.execution-state", () => db.prepare("SELECT s.identity,s.state AS storage_state,r.id AS run_id,r.owner_id,r.state AS run_state,a.activated_at FROM restore_storage s LEFT JOIN restore_runs r ON 1=1 LEFT JOIN restore_activations a ON a.run_id=r.id WHERE s.slot=1").first());
  if (value === null) return null;
  const row = stateRow.parse(value); const identity = restoreStorageIdentity.parse(JSON.parse(row.identity));
  if (identity.purpose !== "restore-test") return null;
  const active: boolean = row.storage_state === "ready" && identity.owner.userId === owner.userId && row.owner_id === owner.userId && row.run_state === "activated" && row.activated_at !== null;
  return { runId: row.run_id, activatedAt: row.activated_at, learning: active ? "active" : "quarantined", externalAuthority: "unverified" };
}
/** 최신 예산·예약·외부 반영 대사가 없는 복원 대상에서는 읽기 API도 자동 호출하지 않습니다. */
export async function requireCurrentExecutionAuthority(db: AtomicDatabase, owner: SiteIdentity): Promise<void> {
  if (await readRestoredExecution(db, owner) !== null) throw Object.assign(new Error("복원한 과거 원장과 현재 사용량의 대사가 필요합니다. AI·Google 호출과 기존 작업 재실행은 잠겨 있습니다."), { name: "RestoreExecutionFailure", code: "restore_execution_unverified", status: 423 });
}
