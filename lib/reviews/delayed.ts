import { instant,seoulCalendarDate,calendarDate } from "./calendar.ts";
import type { SeoulTimezone } from "./calendar.ts";
import { confirmedReviewEvidence } from "./contracts.ts";
import type { ConfirmedReviewEvidence } from "./contracts.ts";
import { unassistedPass } from "./schedule.ts";

export type DelayedCheck=Readonly<{scheduled:boolean;kind:"variable"|"delayed-recall";dueDate:string;baselineAt:number;correctedAt:number|null;evidence:ConfirmedReviewEvidence|null}>;
export type DelayedJudgment=Readonly<{confirmed:boolean;answerId:string|null;resultVersionId:string|null;reasons:readonly string[]}>;
/** 일정의 경과가 아니라 예정된 과제의 실제 독립 답안과 확정 평가만 지연 재현으로 인정합니다. */
export function judgeDelayedRecall(input:DelayedCheck,timezone:SeoulTimezone):DelayedJudgment {
  const due=calendarDate.parse(input.dueDate);const baseline=seoulCalendarDate(instant.parse(new Date(input.baselineAt).toISOString()),timezone);const evidence=input.evidence===null ? null : confirmedReviewEvidence.parse(input.evidence);
  const reasons:string[]=[];
  if(!input.scheduled || input.kind!=="delayed-recall") reasons.push("수락된 지연 복습 일정이 아니에요.");
  if(!evidence) reasons.push("실제 답안과 확정된 평가가 없어요.");
  if(evidence){const submitted=seoulCalendarDate(instant.parse(new Date(evidence.submittedAt).toISOString()),timezone);if(submitted<due || submitted<=baseline) reasons.push("예정일 이후이면서 이전 독립 수행보다 늦은 서울 날짜에 제출해야 해요.");if(!unassistedPass(evidence)) reasons.push("첫 독립 제출의 통과를 확인하지 못했어요.");if(input.correctedAt!==null && evidence.submittedAt<=input.correctedAt) reasons.push("정정 이후의 새 답안이 필요해요.");}
  return {confirmed:reasons.length===0,answerId:evidence?.answerId ?? null,resultVersionId:evidence?.resultVersionId ?? null,reasons};
}
