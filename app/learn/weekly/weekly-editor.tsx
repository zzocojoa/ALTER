"use client";
import { WeeklyAnalogyFields } from "./weekly-analogy";
import { WeeklyTime } from "./weekly-time";
import { WeeklyClaimChoices } from "./weekly-evidence";
import type { FormEvent,ReactElement } from "react";
import { weeklyEdit } from "@/lib/weekly/workspace";
import type { WeeklyEdit,WeeklyWorkspace } from "@/lib/weekly/workspace";
import { supportedWeeklyClaims } from "@/lib/weekly/claims";
import { allocateWeeklyProposal } from "@/lib/weekly/planning";
import { weeklyAdjustmentRules } from "@/lib/weekly/adjustments";

function text(data:FormData,key:string):string {const value=data.get(key);if(typeof value!=="string") throw new Error(`입력 항목이 없어요: ${key}`);return value;}
function lines(data:FormData,key:string):string[]{return text(data,key).split("\n").map(value=>value.trim()).filter(value=>value.length>0);}
export function WeeklyEditor({state,disabled,covered,onSave,onError,onDirty}:Readonly<{state:WeeklyWorkspace;disabled:boolean;covered:boolean;onSave:(input:WeeklyEdit)=>Promise<void>;onError:(message:string)=>void;onDirty:()=>void}>):ReactElement {
  const proposal=state.proposal;if(!proposal) return <p>가용 시간을 저장한 뒤 주간 초안을 생성해 주세요. 학습 기록이 없는 주에는 성과를 만들지 않아요.</p>;
  const catalog=supportedWeeklyClaims(state.context.aggregate,state.context.sources.map(source=>source.id));const allocation=allocateWeeklyProposal(proposal,state.context);const rules=weeklyAdjustmentRules(state.context);
  function submit(event:FormEvent<HTMLFormElement>):void {
    event.preventDefault();const data=new FormData(event.currentTarget);
    try{const next=weeklyEdit.parse({availableMinutes:Number(text(data,"availableMinutes")),notes:text(data,"notes"),proposal:{...proposal,uncertainty:lines(data,"uncertainty"),claimIds:data.getAll("claims"),items:proposal!.items.filter((_item,index)=>data.has(`keep-${index}`)).map(item=>{const index=proposal!.items.indexOf(item);return {...item,activity:text(data,`activity-${index}`),estimatedMinutes:Number(text(data,`minutes-${index}`))};}),roommate:{...proposal!.roommate,facts:proposal!.roommate.facts.map((fact,index)=>({...fact,content:text(data,`fact-${index}`),status:text(data,`fact-status-${index}`)})),analogy:{...proposal!.roommate.analogy,otherDomain:text(data,"otherDomain"),example:text(data,"example"),similarities:lines(data,"similarities"),differences:lines(data,"differences"),limitations:lines(data,"limitations")}}}});void onSave(next);}catch(error:unknown){if(!(error instanceof Error)) throw error;onError("입력 내용을 확인해 주세요. 시간은 정수로, 비교 항목은 빈칸 없이 입력해야 해요.");}
  }
  return <form className="weekly-editor" onSubmit={submit} onChange={onDirty}><fieldset disabled={disabled}><legend>주간 초안 편집</legend>
    <nav className="weekly-review-nav" aria-label="주간 초안 검토 순서"><a href="#weekly-achievements">1 성과</a><a href="#weekly-difficulties">2 어려움·미확인</a><a href="#weekly-improvements">3 개선 메모</a><a href="#weekly-next-plan">4 다음 주 계획</a></nav>
    <p>위에서부터 검토하고 마지막에 초안을 저장해 주세요. 저장과 공식 확정은 별도예요.</p>
    <section id="weekly-achievements" className="weekly-section" aria-labelledby="weekly-achievements-title"><span className="weekly-step">01 · 확정 답안 확인</span><h3 id="weekly-achievements-title">확인할 성과</h3>
      <WeeklyClaimChoices catalog={catalog} selected={proposal.claimIds}/>
    </section>
    <section id="weekly-difficulties" className="weekly-section" aria-labelledby="weekly-difficulties-title"><span className="weekly-step">02 · 확인이 필요한 부분</span><h3 id="weekly-difficulties-title">어려움과 미확인 사항</h3><p>아직 확인하지 않은 설명·계획의 한계를 검토해요. 어려웠던 경험은 아래 내 메모에 적을 수 있어요.</p><label>미확인 사항과 예상의 한계 · 한 줄에 하나<textarea name="uncertainty" required defaultValue={proposal.uncertainty.join("\n")}/></label></section>
    <section id="weekly-improvements" className="weekly-section" aria-labelledby="weekly-improvements-title"><span className="weekly-step">03 · 내가 돌아본 점</span><h3 id="weekly-improvements-title">개선 메모</h3><p>어려웠던 점과 다음에 바꿔 볼 방법을 적어요. 내 메모는 수행이 확인된 성과와 구분해 보관해요.</p><label>내 메모 · 자기 보고이며 검증된 성과에 합산하지 않아요<textarea name="notes" maxLength={4000} defaultValue={state.notes}/></label></section>
    <section id="weekly-next-plan" className="weekly-section" aria-labelledby="weekly-next-plan-title"><span className="weekly-step">04 · 다음 주 준비</span><h3 id="weekly-next-plan-title">다음 주 행동</h3><WeeklyTime allocation={allocation} units={state.context.units}/><p>입력한 시간을 수정하면 초안 저장 후 배정 결과를 확인해 주세요.</p><label>다음 주 가용 시간 (분)<input name="availableMinutes" type="number" required min={0} max={10080} step={1} defaultValue={state.context.availableMinutes ?? ""}/></label><p>각 활동은 예상 시간 전체를 배정해요. 시간이 부족한 활동은 미배정으로 남고 기존 복습 일정은 유지돼요.</p>
    {proposal.items.map((item,index)=>{const rule=rules.find(rule=>rule.unitId===item.unitId && rule.action===item.action && rule.targetUnitId===item.targetUnitId);const assigned=allocation.items.find(entry=>entry.item===item);return <section className="weekly-item" key={`${item.unitId}:${item.action}:${item.targetUnitId}`}><label className="weekly-check"><input type="checkbox" name={`keep-${index}`} defaultChecked/><span>{state.context.units.find(unit=>unit.unitId===item.targetUnitId)?.title} · {assigned?.status==="assigned" ? "배정" : "미배정"}</span></label><p>{rule?.reason}</p><p>저장된 배정 {assigned?.allocatedMinutes}분 · {assigned?.reason}</p><label>직접 할 행동<textarea name={`activity-${index}`} required maxLength={2000} defaultValue={item.activity}/></label><label>예상 소요 시간 (분)<input name={`minutes-${index}`} type="number" required min={5} max={240} step={1} defaultValue={item.estimatedMinutes}/></label>{item.claimIds.map(id=>{const claim=catalog.find(claim=>claim.id===id);return claim ? <p key={id}><a href={`#weekly-answer-${claim.answerId}`}>{claim.content}</a></p> : null;})}</section>;})}</section>
    <section className="weekly-section" aria-labelledby="weekly-roommate-title"><h3 id="weekly-roommate-title">Roommate · 내용과 비유</h3><p>‘원문 확인’은 선택한 원문과 일치함을 뜻해요. 내용의 절대적 사실성이나 학습 성과를 보증하지 않아요.</p>{proposal.roommate.facts.map((fact,index)=><section className="weekly-item" key={index}><label>내용 설명 {index+1}<textarea name={`fact-${index}`} required maxLength={2000} defaultValue={fact.content}/></label><label>확인 상태<select name={`fact-status-${index}`} defaultValue={fact.status}><option value="source-checked">원문 확인</option><option value="unverified">미확인 설명</option></select></label>{!covered && fact.quote && <blockquote>{fact.quote}</blockquote>}{fact.sourceRefId && <p>출처: 파일 {state.context.sources.find(source=>source.id===fact.sourceRefId)?.filePage}쪽의 선택 원문</p>}</section>)}
    <WeeklyAnalogyFields analogy={proposal.roommate.analogy}/></section>
    <div className="weekly-save-action"><button type="submit">수정한 초안 저장</button><p>저장한 초안을 확인한 뒤 주간 내용 확정을 진행해요.</p></div>
  </fieldset></form>;
}
