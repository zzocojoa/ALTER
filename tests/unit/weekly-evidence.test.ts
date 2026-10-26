import { describe,expect,it } from "vitest";
import { weekContaining,withinWeek } from "../../lib/weekly/period";
import { aggregateWeeklyEvidence } from "../../lib/weekly/evidence";
import { weeklyEvidenceFixture } from "../fixtures/weekly-evidence";
import { editorReadyFixture } from "../fixtures/editor-state";
import { tutorState } from "../../lib/tutor/contracts";
import { tutorId } from "../fixtures/tutor-state";

describe("서울 주간과 확정 답안 집계",()=>{
  it("서울 월요일 자정 포함·다음 월요일 제외를 UTC와 구분한다",()=>{
    const week=weekContaining("2026-10-25");expect(week.start).toBe("2026-10-19");expect(week.endExclusive).toBe("2026-10-26");expect(new Date(week.startAt).toISOString()).toBe("2026-10-18T15:00:00.000Z");expect(withinWeek(week,week.startAt)).toBe(true);expect(withinWeek(week,week.startAt-1)).toBe(false);expect(withinWeek(week,week.endAt-1)).toBe(true);expect(withinWeek(week,week.endAt)).toBe(false);
  });
  it("연도 경계와 실제 달력 날짜를 검사한다",()=>{expect(weekContaining("2027-01-01").start).toBe("2026-12-28");expect(()=>weekContaining("2026-02-30")).toThrow();});
  it("빈 주간도 기간·빈 집계·증거 지문을 반환한다",async()=>{const input=weeklyEvidenceFixture();const result=await aggregateWeeklyEvidence({...input,sessions:[]});expect(result.counts.sessions).toBe(0);expect(result.answers).toEqual([]);expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/);});
  it("확정된 자기 설명·새 조건만 각각 세고 일반 통과를 지연 재현으로 올리지 않는다",async()=>{const result=await aggregateWeeklyEvidence(weeklyEvidenceFixture());expect(result.counts).toMatchObject({sessions:1,answers:2,independentNewConditions:1,independentExplanations:1,delayedRecall:0});expect(result.answers.every(item=>item.resultVersionId===tutorId(1310))).toBe(true);});
  it("주간 밖 확정과 미확정 답안은 성과에서 제외한다",async()=>{const input=weeklyEvidenceFixture();const result=await aggregateWeeklyEvidence({...input,sessions:input.sessions.map(item=>({...item,confirmedAt:input.period.endAt})),answers:[...input.answers,{...input.answers[0],id:tutorId(1399)}]});expect(result.counts.answers).toBe(0);});
  it("공식 확정에 추가로 연결되지 않은 답안은 포함하지 않는다",async()=>{const input=weeklyEvidenceFixture();const result=await aggregateWeeklyEvidence({...input,answers:[...input.answers,{...input.answers[0],id:tutorId(1399)}]});expect(result.answers).toHaveLength(2);});
  it("도움 노출 후 같은 답안은 독립 수행으로 합산하지 않는다",async()=>{const input=weeklyEvidenceFixture();const result=await aggregateWeeklyEvidence({...input,answers:input.answers.map(item=>({...item,helpIds:[tutorId(1320)]}))});expect(result.counts.independentNewConditions).toBe(0);expect(result.counts.helpedAnswers).toBe(2);expect(result.answers.every(item=>item.needsRecheck)).toBe(true);});
  it("현재 정정이 이전 답안을 재검증 대상으로 만들고 지문을 바꾼다",async()=>{const input=weeklyEvidenceFixture();const first=await aggregateWeeklyEvidence(input);const second=await aggregateWeeklyEvidence({...input,corrections:[{id:tutorId(1330),errorId:tutorId(1331),unitId:input.sessions[0].state.start.bundle.unit.unitId,answerId:input.answers[0].id,createdAt:input.period.startAt+200,reason:"잘못된 설명 수정",evidence:"정정 근거"}]});expect(second.answers.every(item=>item.needsRecheck)).toBe(true);expect(second.counts.independentNewConditions).toBe(0);expect(second.fingerprint).not.toBe(first.fingerprint);});
  it("실제 답안 누락을 식별자와 함께 명시적으로 실패시킨다",async()=>{const input=weeklyEvidenceFixture();await expect(aggregateWeeklyEvidence({...input,answers:[]})).rejects.toMatchObject({operation:"weekly.confirmed-answer-reference",cause:{answerId:input.answers[0].id,sessionId:input.sessions[0].sessionId}});});
  it("답안 버전과 내용이 확정 증거와 다르면 실패한다",async()=>{const input=weeklyEvidenceFixture();await expect(aggregateWeeklyEvidence({...input,answers:input.answers.map(item=>({...item,version:99}))})).rejects.toMatchObject({operation:"weekly.answer-version"});await expect(aggregateWeeklyEvidence({...input,answers:input.answers.map(item=>({...item,text:"교체된 답안"}))})).rejects.toMatchObject({operation:"weekly.confirmed-answer-reference"});});
  it("중복 확정 참조를 조용히 중복 합산하지 않는다",async()=>{const input=weeklyEvidenceFixture();await expect(aggregateWeeklyEvidence({...input,sessions:[...input.sessions,...input.sessions]})).rejects.toMatchObject({operation:"weekly.duplicate-confirmed-session"});});
  it("다른 과정·확정 사건 판·평가 누락을 허용하지 않는다",async()=>{const input=weeklyEvidenceFixture();await expect(aggregateWeeklyEvidence({...input,courseId:tutorId(1340)})).rejects.toMatchObject({operation:"weekly.confirmation-state"});await expect(aggregateWeeklyEvidence({...input,sessions:input.sessions.map(item=>({...item,sessionVersion:item.sessionVersion+1}))})).rejects.toMatchObject({operation:"weekly.confirmation-state"});await expect(aggregateWeeklyEvidence({...input,sessions:input.sessions.map(item=>({...item,state:{...item.state,diagnoses:[]}}))})).rejects.toMatchObject({operation:"weekly.accepted-diagnosis-missing"});});
  it("Editor 수정 이유와 해결 항목을 보존하고 독립 수행으로 바꾸지 않는다",async()=>{
    const input=weeklyEvidenceFixture();const editor=editorReadyFixture();const state=tutorState.parse({...editor,phase:"finished",version:editor.version+1});const session={...input.sessions[0],sessionVersion:editor.version,state,judgment:{...input.sessions[0].judgment,evidence:[],explanation:null,variation:null}};
    const answers=state.answers.map(answer=>({id:answer.id,sessionId:state.id,questionId:answer.questionId,attemptId:answer.attemptId,version:2,text:answer.text,submittedAt:answer.submittedAt,hidden:1,mode:"initial",status:"ready",helpIds:state.help.filter(item=>item.questionId===answer.questionId).map(item=>item.id)}));
    const result=await aggregateWeeklyEvidence({...input,sessions:[session],answers});expect(result.counts.editorImprovements).toBe(1);expect(result.counts.independentNewConditions).toBe(0);expect(result.answers.find(item=>item.id===tutorId(30))?.editorRevision?.reason).toBe("전체와 부분 구분");
  });

});
