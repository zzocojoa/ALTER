import { domainFailure } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import type { ExternalOperationRow } from "./external-operation.ts";
import { readStorage,requireInBatch } from "./atomic.ts";

const kinds:readonly string[]=["sheet-header-write","sheet-row-append","report-row-append","report-row-update","report-row-verify"];
/** 동일 표의 다른 작업은 이전 결과가 확인되거나 충돌로 끝날 때까지 선점할 수 없습니다. */
export function externalSheetClaimStatements(db:D1Database,owner:SiteIdentity,row:ExternalOperationRow,requestId:string):readonly D1PreparedStatement[] {
  if(!kinds.includes(row.kind)) return [];
  if(!row.externalId) throw domainFailure("reference_conflict","external.sheet-lock.target-required",null);
  return [db.prepare("INSERT INTO external_sheet_locks(owner_id,google_subject,external_id,operation_id) SELECT owner_id,google_subject,?,? FROM external_workflows WHERE owner_id=? AND id=? ON CONFLICT(owner_id,google_subject,external_id) DO UPDATE SET operation_id=excluded.operation_id WHERE external_sheet_locks.operation_id=excluded.operation_id OR EXISTS(SELECT 1 FROM external_operations o WHERE o.owner_id=external_sheet_locks.owner_id AND o.id=external_sheet_locks.operation_id AND o.state IN ('confirmed','conflict'))").bind(row.externalId,row.id,owner.userId,row.workflowId),
    requireInBatch(db,owner.userId,requestId,2,"EXISTS(SELECT 1 FROM external_sheet_locks l JOIN external_workflows w ON w.owner_id=l.owner_id AND w.google_subject=l.google_subject WHERE l.owner_id=? AND l.external_id=? AND l.operation_id=? AND w.id=?)",[owner.userId,row.externalId,row.id,row.workflowId]),
  ];
}
export async function requireExternalSheetLock(db:D1Database,owner:SiteIdentity,row:ExternalOperationRow):Promise<void> {
  if(!kinds.includes(row.kind)) return;
  const lock=await readStorage("external.sheet-lock.current",()=>db.prepare("SELECT l.operation_id FROM external_sheet_locks l JOIN external_workflows w ON w.owner_id=l.owner_id AND w.google_subject=l.google_subject WHERE l.owner_id=? AND l.external_id=? AND l.operation_id=? AND w.id=?").bind(owner.userId,row.externalId,row.id,row.workflowId).first());
  if(!lock) throw domainFailure("version_conflict","external.sheet-lock.lost",null);
}
