import { z } from "zod";
import { recordId } from "../domain/contracts";

const progress=z.object({view:z.object({state:z.string(),operations:z.array(z.object({state:z.string()}))}),disposition:z.enum(["advanced","busy","deferred","retained"])});
/** 한 번의 사용자 실행 안에서 확인 가능한 단계만 진행하고 대기·충돌·응답 유실은 화면으로 돌려줍니다. */
export async function advanceExternalWorkflow(id:string,onProgress:(message:string)=>void):Promise<void> {
  recordId.parse(id);
  for(let step:number=0;step<80;step+=1){
    const response=await fetch("/api/external",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id}),cache:"no-store"});const raw:unknown=await response.json();
    if(!response.ok){const error=z.object({message:z.string()}).safeParse(raw);throw new Error(error.success?error.data.message:"작업 응답을 확인하지 못했어요. 저장 상태를 확인해 주세요.");}
    const result=progress.parse(raw);const done=result.view.operations.filter(item=>item.state==="confirmed").length;onProgress(`${done}/${result.view.operations.length}단계 확인됨`);
    if(result.view.state==="confirmed") return;
    if(result.disposition!=="advanced" || ["conflict","failed","unknown"].includes(result.view.state)) throw new Error("아직 확인되지 않은 단계가 있어요. 저장 상태를 확인한 뒤 이어서 진행해 주세요.");
  }
  throw new Error("이번 실행의 단계 수를 넘었어요. 저장 상태를 확인한 뒤 이어서 진행해 주세요.");
}

/** 재조회 요청에는 새 쓰기나 자동 이어하기를 포함하지 않습니다. */
export async function verifyExternalWorkflowConflict(id:string):Promise<void> {
  recordId.parse(id);const response=await fetch("/api/external",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id,action:"verify-conflict"}),cache:"no-store"});const raw:unknown=await response.json();
  if(!response.ok){const error=z.object({message:z.string()}).safeParse(raw);throw new Error(error.success?error.data.message:"Google 결과 재조회에 실패했어요.");}
  const result=progress.parse(raw);if(result.view.state==="conflict")throw new Error("현재 Google 내용이 확정 기록과 달라요. 내용은 변경하지 않았어요.");
  if(["failed","unknown"].includes(result.view.state))throw new Error("Google 결과를 확인하지 못했어요. 저장 상태를 확인해 주세요.");
}
