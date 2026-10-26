import { expect,it } from "vitest";
import { calculateResult,hasDelayedRecall } from "../../lib/results/evidence";
import type { JudgmentInput } from "../../lib/results/evidence";
import { resultFixture } from "../fixtures/result-state";
import { tutorId } from "../fixtures/tutor-state";
it("두 실제 무도움 증거로 통과해도 지연 재현은 미확인이고 입력은 불변이다",()=>{const input=resultFixture();const before=JSON.stringify(input);const result=calculateResult(input);expect(result.unitPassed).toBe(true);expect(result.progress).toBe("완료");expect(result.delayedRecall).toBe("미확인");expect(result.nextAction).toContain("다음 단원");expect(result.explanation?.answerId).toBe(tutorId(14));expect(result.variation?.answerVersion).toBe(2);expect(calculateResult(input)).toEqual(result);expect(JSON.stringify(input)).toBe(before);});
it.each(["explanation-only","variation-only","no-answer","unfinished-evaluation","visible","no-exposure","same-help","missing-fingerprint","correction","old-plan","copied-answer","same-prompt","same-condition","missing-lineage"])("불충분하거나 노출된 증거는 통과하지 않는다: %s",(kind)=>{
  const value=resultFixture();const state=value.states[0];let input:JudgmentInput=value;
  if(kind==="explanation-only" || kind==="variation-only" || kind==="no-answer") input={...value,states:[{...state,answers:kind==="no-answer" ? [] : state.answers.filter((_,i)=>i===(kind==="explanation-only" ? 0 : 1))}]};
  if(kind==="unfinished-evaluation") input={...value,states:[{...state,diagnoses:[]}]};
  if(kind==="visible") input={...value,facts:value.facts.map((fact)=>({...fact,hidden:0}))};
  if(kind==="no-exposure") input={...value,facts:value.facts.map((fact)=>({...fact,exposureVersion:null}))};
  if(kind==="same-help") input={...value,facts:value.facts.map((fact)=>({...fact,helpIds:JSON.stringify([tutorId(91)])}))};
  if(kind==="missing-fingerprint") input={...value,states:[{...state,answers:state.answers.map((answer)=>({...answer,contentFingerprint:undefined}))}]};
  if(kind==="correction") input={...value,correctionRequired:true};
  if(kind==="old-plan") input={...value,planVersionId:tutorId(99)};
  if(kind==="copied-answer") input={...value,states:[{...state,answers:state.answers.map((answer)=>({...answer,contentFingerprint:"a".repeat(64)}))}]};
  if(kind==="same-prompt") input={...value,states:[{...state,questions:state.questions.map((question)=>({...question,prompt:state.questions[0].prompt}))}]};
  if(kind==="same-condition") {const relation={...state.variations[0],change:{...state.variations[0].change,after:state.variations[0].change.before}};input={...value,states:[{...state,variations:[relation]}],facts:value.facts.map((fact)=>({...fact,variation:JSON.stringify(relation)}))};}
  if(kind==="missing-lineage") input={...value,facts:value.facts.map((fact)=>({...fact,variation:null}))};
  expect(calculateResult(input).unitPassed).toBe(false);
});
it("동일 문제 재시도는 인정하지 않고 이전 도움은 새 조건 답안과 분리한다",()=>{const value=resultFixture();const helped={...value,facts:value.facts.map((fact,index)=>({...fact,helpIds:index===0 ? JSON.stringify([tutorId(91)]) : "[]"}))};expect(calculateResult(helped).variation?.accepted).toBe(true);expect(calculateResult(helped).explanation).toBeNull();const state=value.states[0];const retry={...state.answers[1],id:tutorId(93),submittedAt:3};expect(calculateResult({...value,states:[{...state,answers:[...state.answers,retry]}],facts:[...value.facts,{...value.facts[1],id:retry.id}]}).evidence.at(-1)?.accepted).toBe(false);});
it("지연 상태는 실제 다음 학습일의 무도움 답안 없이 바뀌지 않는다",()=>{const base={answerId:tutorId(90),correct:true,hidden:true,helped:false,performedAt:Date.parse("2026-10-25T00:00:00Z"),independentAt:Date.parse("2026-10-24T00:00:00Z")};expect(hasDelayedRecall([])).toBe(false);expect(hasDelayedRecall([base])).toBe(true);expect(hasDelayedRecall([{...base,performedAt:base.independentAt+1000}])).toBe(false);expect(hasDelayedRecall([{...base,helped:true}])).toBe(false);expect(hasDelayedRecall([{...base,correct:false}])).toBe(false);});

it("교체된 출처의 과거 수행은 제외하고 새 출처의 근거만 사용한다",()=>{const input=resultFixture();const blocked=calculateResult({...input,invalidSourceIds:[tutorId(7)]});expect(blocked.unitPassed).toBe(false);expect(blocked.evidence[0].reasons).toContain("이 답안의 출처가 교체되거나 정정되어 현재 근거로 사용할 수 없어요.");});

it("도움 제공만으로 성공 수행을 만들거나 누락된 답안 버전을 꾸미지 않는다",()=>{const input=resultFixture();const state=input.states[0];const value={...input,states:[{...state,diagnoses:state.diagnoses.map((diagnosis)=>({...diagnosis,correct:false,needsHelp:true}))}],facts:input.facts.map((fact)=>({...fact,helpIds:JSON.stringify([tutorId(99)])}))};expect(calculateResult(value).performance).toBe("설명 필요");expect(calculateResult({...input,facts:[]}).evidence[0].answerVersion).toBeNull();});
