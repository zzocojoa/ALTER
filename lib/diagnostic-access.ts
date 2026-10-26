import { readRestoredExecution } from "../db/repositories/restore-execution";
import type { AtomicDatabase } from "../db/repositories/atomic";
import type { SiteIdentity } from "./domain/contracts";
import { privateJson } from "./owner-access";
import { RESTORE_DIAGNOSTIC_MESSAGE } from "./diagnostic-message";

/** 복원 환경의 외부 실행 차단과 충돌하는 진단은 임시 기록을 만들기 전에 거부합니다. */
export async function diagnosticRejection(db: AtomicDatabase, owner: SiteIdentity): Promise<Response | null> {
  return await readRestoredExecution(db, owner) === null ? null : privateJson({ error: "restore_diagnostic_unavailable", message: RESTORE_DIAGNOSTIC_MESSAGE }, 423);
}
