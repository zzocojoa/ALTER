import { recordId } from "../../lib/domain/contracts";
import { describe,it,expect } from "vitest";
import { errorEvidence,makeReviewTask,reviewSubmission,submissionText,confirmedReviewEvidence } from "../../lib/reviews/contracts";
import type { LearningType,ConfirmedReviewEvidence,ReviewConditions } from "../../lib/reviews/contracts";
import { instant,seoulCalendarDate,calendarDate,addCalendarDays } from "../../lib/reviews/calendar";
import { proposeInterval } from "../../lib/reviews/schedule";
import { judgeDelayedRecall } from "../../lib/reviews/delayed";
const id=recordId.parse("00000000-0000-4000-a000-000000000001");
const now=instant.parse("2026-10-24T16:00:00Z");const time=Date.parse(now);
const conditions:ReviewConditions={goalDate:null,retentionDays:90,availableMinutes:20,requiredMinutes:10};
const evidence:ConfirmedReviewEvidence=confirmedReviewEvidence.parse({status:"confirmed",resultVersionId:id,resultOrdinal:2,answerId:id,submittedAt:time-1000,confirmedAt:time,correct:true,hidden:true,helpIds:[],exposed:false,firstAttempt:true,evaluation:"원문 기준 통과"});
describe("공식 오답과 유형별 복습 계약",()=>{
  it("원인 미확인을 보존하고 초안 및 버전 누락을 거부한다",()=>{const input={resultVersionId:id,resultOrdinal:2,questionId:id,answerId:id,answerVersion:1,sourceRefIds:[id],helpIds:[id],concept:"분수",feedback:"정의 확인",cause:{status:"unverified"}};expect(errorEvidence.parse(input)).toEqual(input);expect(()=>errorEvidence.parse({...input,resultOrdinal:0})).toThrow();expect(()=>errorEvidence.parse({...input,cause:{status:"documented",description:"추측"}})).toThrow();expect(()=>errorEvidence.parse({...input,status:"draft"})).toThrow();});
  it.each(["memory","concept","skill","judgment"] as const)("%s의 제출 증거와 형식을 구분한다",(type:LearningType)=>{const task=makeReviewTask(type,"같은 크기와 부분 설명",id,"원문제",[id]);const inputs={memory:{type:"memory",recall:"분모"},concept:{type:"concept",example:"3/7",explanation:"같은 크기로 나눈 전체"},skill:{type:"skill",work:"새 조건 계산",output:"2/7"},judgment:{type:"judgment",case:"두 양 비교",choice:"왼쪽",reason:"동일 기준"}};expect(submissionText(task,reviewSubmission.parse(inputs[type]))).not.toBe("");expect(task.prompt).toContain("확인 기준");expect(()=>submissionText(task,reviewSubmission.parse(inputs[type==="memory" ? "concept" : "memory"]))).toThrow();});
  it("개념 예시·판단 이유·기술 결과를 생략할 수 없다",()=>{for(const value of [{type:"concept",explanation:"설명"},{type:"judgment",case:"사례",choice:"선택"},{type:"skill",work:"수행"}]) expect(()=>reviewSubmission.parse(value)).toThrow();});
});
describe("서울 달력",()=>{
  it("오프셋이 다른 동일 시각과 자정을 구분한다",()=>{expect(seoulCalendarDate(instant.parse("2026-10-24T14:59:59Z"),"Asia/Seoul")).toBe("2026-10-24");expect(seoulCalendarDate(instant.parse("2026-10-24T15:00:00Z"),"Asia/Seoul")).toBe("2026-10-25");expect(seoulCalendarDate(instant.parse("2026-10-25T00:00:00+09:00"),"Asia/Seoul")).toBe("2026-10-25");});
  it.each([["2024-02-28","2024-02-29"],["2024-02-29","2024-03-01"],["2025-02-28","2025-03-01"],["2026-12-31","2027-01-01"]])("%s의 다음 달력 날짜",(from,to)=>expect(addCalendarDays(calendarDate.parse(from),1)).toBe(to));
  it("모호한 시각·날짜·시간대를 거부한다",()=>{expect(()=>instant.parse("2026-10-25T00:00:00")).toThrow();expect(()=>calendarDate.parse("2026-02-29")).toThrow();expect(()=>seoulCalendarDate(now,"UTC" as "Asia/Seoul")).toThrow();expect(()=>addCalendarDays(calendarDate.parse("2026-01-01"),-1)).toThrow();});
});
describe("간격 제안과 실제 지연 재현",()=>{
  it("1·3·7·14·30일 순서와 마지막 반복을 보존한다",()=>{expect(proposeInterval(0,{kind:"initial"},conditions,now,"Asia/Seoul").baseDays).toBe(1);expect([0,1,2,3,4].map((stage)=>proposeInterval(stage,{kind:"confirmed",evidence},conditions,now,"Asia/Seoul").baseDays)).toEqual([3,7,14,30,30]);});
  it.each([{correct:false},{hidden:false},{helpIds:[id]},{exposed:true},{firstAttempt:false}])("실패·도움·노출·재시도는 단계 유지와 다음 날",(patch)=>{const proposal=proposeInterval(2,{kind:"confirmed",evidence:{...evidence,...patch}},conditions,now,"Asia/Seoul");expect([proposal.stage,proposal.adjustedDays,proposal.dueDate]).toEqual([2,1,"2026-10-26"]);});
  it("미제출을 성공 또는 실패로 만들지 않는다",()=>{const p=proposeInterval(2,{kind:"not-submitted"},conditions,now,"Asia/Seoul");expect(p.stage).toBe(2);expect(p.outcome).toBe("not-submitted");expect(p.evidence).toBeNull();});
  it("목표·유지 기간·가용 시간과 충돌의 이유를 저장한다",()=>{const p=proposeInterval(3,{kind:"initial"},{...conditions,goalDate:"2026-10-27",retentionDays:5,availableMinutes:0},now,"Asia/Seoul");expect(p.adjustedDays).toBe(2);expect(p.needsTime).toBe(true);expect(p.reasons).toHaveLength(4);expect(proposeInterval(4,{kind:"initial"},{...conditions,goalDate:"2026-10-24"},now,"Asia/Seoul").reasons.some((r)=>r.includes("충돌"))).toBe(true);});
  it("입력을 변경하지 않고 동일 입력의 같은 제안을 반환한다",()=>{const input=Object.freeze({...conditions});expect(proposeInterval(1,{kind:"confirmed",evidence},input,now,"Asia/Seoul")).toEqual(proposeInterval(1,{kind:"confirmed",evidence},input,now,"Asia/Seoul"));expect(input).toEqual(conditions);});
  it("미확정·미래 확정·잘못된 간격을 거부한다",()=>{expect(()=>confirmedReviewEvidence.parse({...evidence,status:"draft"})).toThrow();expect(()=>proposeInterval(0,{kind:"confirmed",evidence:{...evidence,confirmedAt:time+1}},conditions,now,"Asia/Seoul")).toThrow();expect(()=>proposeInterval(5,{kind:"initial"},conditions,now,"Asia/Seoul")).toThrow();});
  it("실제 예정일의 독립 확정만 지연으로 인정한다",()=>{const base={scheduled:true,kind:"delayed-recall" as const,dueDate:"2026-10-25",baselineAt:Date.parse("2026-10-23T16:00:00Z"),correctedAt:null,evidence};expect(judgeDelayedRecall(base,"Asia/Seoul").confirmed).toBe(true);for(const change of [{evidence:null},{scheduled:false},{kind:"variable" as const},{dueDate:"2026-10-26"},{baselineAt:time-2000},{correctedAt:time},{evidence:{...evidence,helpIds:[id]}},{evidence:{...evidence,correct:false}}]) expect(judgeDelayedRecall({...base,...change},"Asia/Seoul").confirmed).toBe(false);});
});
