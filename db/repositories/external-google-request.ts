import { z } from "zod";
import { domainFailure,recordId } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import { googleBatchSubrequests } from "../../lib/google/rest-request.ts";
import type { GoogleRestRequest } from "../../lib/google/rest-request.ts";
import { externalLease } from "./external-operation.ts";
import { readStorage } from "./atomic.ts";

export const externalGoogleContext=z.object({attemptId:recordId,lease:externalLease}).strict();
export type ExternalGoogleContext=Readonly<z.infer<typeof externalGoogleContext>>;
/** 보조 조회를 포함한 실제 요청을 현재 선점 시도에 묶은 뒤에만 전송합니다. */
export async function recordExternalGoogleRequest(db:D1Database,owner:SiteIdentity,id:string,value:ExternalGoogleContext|null,request:GoogleRestRequest,now:number):Promise<void> {
  if(value===null) return;
  const context=externalGoogleContext.parse(value);recordId.parse(id);
  const row=await readStorage("external.google-request.context",()=>db.prepare("INSERT INTO external_google_requests(owner_id,id,attempt_id,batch_subrequests,response_upper_bytes) SELECT q.owner_id,q.id,a.id,?,? FROM google_requests q JOIN external_attempt_records a ON a.owner_id=q.owner_id JOIN external_operations o ON o.owner_id=a.owner_id AND o.id=a.operation_id JOIN external_workflows w ON w.owner_id=o.owner_id AND w.id=o.workflow_id WHERE q.owner_id=? AND q.id=? AND q.state='reserved' AND q.sent_at IS NULL AND q.request_hash=? AND q.google_subject=w.google_subject AND a.id=? AND a.state='started' AND o.id=? AND o.version=? AND o.state='running' AND o.lease_id=? AND o.lease_epoch=? AND o.lease_until>? AND a.lease_id=o.lease_id AND a.lease_epoch=o.lease_epoch RETURNING id").bind(googleBatchSubrequests(request),request.maximumBytes,owner.userId,id,request.hash,context.attemptId,context.lease.operationId,context.lease.expectedVersion,context.lease.leaseId,context.lease.epoch,now).first<{id:string}>());
  if(!row) throw domainFailure("version_conflict","external.google-request.context-lost",null);
}
