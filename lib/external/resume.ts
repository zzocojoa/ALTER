import { z } from "zod";
import { domainFailure,recordId } from "../domain/contracts.ts";
import type { SiteIdentity } from "../domain/contracts.ts";
import { readStorage } from "../../db/repositories/atomic.ts";
import { readExternalOperation } from "../../db/repositories/external-operation.ts";
import { externalWorkflowState } from "./state.ts";
import { externalFailure } from "./failure.ts";
import type { ExternalFailure } from "./failure.ts";
import { runExternalOperation,recheckExternalConflict } from "./execute.ts";
import type { ExternalExecutionResult,ExternalExecutionRuntime,ExternalTransport } from "./execute.ts";

const workflowView=z.object({id:recordId,version:z.number().int().positive(),kind:z.enum(["weekly-export","calendar"]),state:externalWorkflowState,targetKey:z.string(),sourceVersion:z.string(),deadlineAt:z.number().int().nonnegative()}).strict();
export type ExternalOperationView=Readonly<{id:string;kind:string;ordinal:number;state:string;attemptCount:number;nextAttemptAt:number;externalId:string|null;lastFailure:ExternalFailure|null}>;
export type ExternalWorkflowView=Readonly<z.infer<typeof workflowView> & {operations:readonly ExternalOperationView[]}>;
export type ExternalResumeResult=Readonly<{view:ExternalWorkflowView;disposition:ExternalExecutionResult["disposition"]}>;
/** 소유자 신원으로 조회하며 요청 스냅샷·학습 원문·Google 계정 식별값은 진행 화면에 반환하지 않습니다. */
export async function readExternalWorkflowView(db:D1Database,owner:SiteIdentity,id:string):Promise<ExternalWorkflowView> {
  recordId.parse(id);
  const workflow=await readStorage("external.resume.workflow",()=>db.prepare("SELECT id,version,kind,state,target_key AS targetKey,source_version AS sourceVersion,deadline_at AS deadlineAt FROM external_workflows WHERE owner_id=? AND id=?").bind(owner.userId,id).first());
  if(!workflow) throw domainFailure("reference_conflict","external.resume.owner",null);
  const rows=await readStorage("external.resume.operations",()=>db.prepare("SELECT id FROM external_operations WHERE owner_id=? AND workflow_id=? ORDER BY ordinal").bind(owner.userId,id).all<{id:string}>());
  const operations:readonly ExternalOperationView[]=await Promise.all(rows.results.map(async value=>{
    const row=await readExternalOperation(db,owner,value.id);
    return {id:row.id,kind:row.kind,ordinal:row.ordinal,state:row.state,attemptCount:row.attemptCount,nextAttemptAt:row.nextAttemptAt,externalId:row.externalId,lastFailure:row.lastError===null?null:externalFailure.parse(JSON.parse(row.lastError))};
  }));
  return {...workflowView.parse(workflow),operations};
}
/** 요청마다 D1 상태를 새로 읽고 첫 미확인 단계 하나만 재개합니다. */
export async function resumeExternalWorkflow(db:D1Database,owner:SiteIdentity,id:string,transport:ExternalTransport,runtime:ExternalExecutionRuntime):Promise<ExternalResumeResult> {
  const view:ExternalWorkflowView=await readExternalWorkflowView(db,owner,id);
  const next:ExternalOperationView|undefined=view.operations.find(operation=>operation.state!=="confirmed");
  if(view.operations.length===0) throw domainFailure("reference_conflict","external.resume.no-operations",null);
  if(!next) return {view,disposition:"retained"};
  const result:ExternalExecutionResult=await runExternalOperation(db,owner,next.id,transport,runtime);
  return {view:await readExternalWorkflowView(db,owner,id),disposition:result.disposition};
}

/** 일반 이어하기와 구분하여 첫 충돌 단계의 현재 내용만 다시 확인합니다. */
export async function recheckExternalWorkflowConflict(db:D1Database,owner:SiteIdentity,id:string,transport:ExternalTransport,runtime:ExternalExecutionRuntime):Promise<ExternalResumeResult> {
  const view=await readExternalWorkflowView(db,owner,id);const next=view.operations.find(operation=>operation.state!=="confirmed");
  if(next?.state!=="conflict")throw domainFailure("reference_conflict","external.recheck-first-conflict-required",null);
  const result=await recheckExternalConflict(db,owner,next.id,transport,runtime);
  return {view:await readExternalWorkflowView(db,owner,id),disposition:result.disposition};
}
