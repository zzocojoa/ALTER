import { z } from "zod";
import { recordId } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import { externalFailure } from "../../lib/external/failure.ts";
import type { ExternalFailure } from "../../lib/external/failure.ts";
import { readStorage } from "./atomic.ts";

type FailureEntry=Readonly<{attemptId:string;ordinal:number;leaseEpoch:number;failure:ExternalFailure}>;
export type ExternalFailureHistory=Readonly<{write:FailureEntry|null;verify:FailureEntry|null;last:FailureEntry|null}>;
/** 완료된 시도 이력에서 쓰기 오류와 후속 조회 오류를 따로 반환합니다. */
export async function readExternalFailureHistory(db:D1Database,owner:SiteIdentity,operationId:string):Promise<ExternalFailureHistory> {
  recordId.parse(operationId);
  const result=await readStorage("external.errors.history",()=>db.prepare("SELECT id,ordinal,lease_epoch AS leaseEpoch,error FROM external_attempt_records WHERE owner_id=? AND operation_id=? AND error IS NOT NULL AND json_extract(error,'$.phase') IN ('write','verify') ORDER BY ordinal DESC LIMIT 8").bind(owner.userId,operationId).all<{id:string;ordinal:number;leaseEpoch:number;error:string}>());
  const rows:readonly FailureEntry[]=result.results.map(row=>({attemptId:recordId.parse(row.id),ordinal:z.number().int().positive().parse(row.ordinal),leaseEpoch:z.number().int().positive().parse(row.leaseEpoch),failure:externalFailure.parse(JSON.parse(row.error))}));
  return {write:rows.find(row=>row.failure.phase==="write")??null,verify:rows.find(row=>row.failure.phase==="verify")??null,last:rows[0]??null};
}
