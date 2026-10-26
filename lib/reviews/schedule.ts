import { domainFailure } from "../domain/contracts.ts";
import { calendarDate,seoulCalendarDate,addCalendarDays,daysUntil } from "./calendar.ts";
import type { Instant,SeoulTimezone } from "./calendar.ts";
import { confirmedReviewEvidence,intervalProposal,intervalStage,reviewConditions } from "./contracts.ts";
import type { ConfirmedReviewEvidence,IntervalProposal,ReviewConditions } from "./contracts.ts";

export type ReviewOutcome=Readonly<{kind:"initial"}>|Readonly<{kind:"not-submitted"}>|Readonly<{kind:"confirmed";evidence:ConfirmedReviewEvidence}>;
const intervals:readonly number[]=[1,3,7,14,30];
export function unassistedPass(evidence:ConfirmedReviewEvidence):boolean {
  const input=confirmedReviewEvidence.parse(evidence);return input.correct && input.hidden && input.helpIds.length===0 && !input.exposed && input.firstAttempt;
}
/** 각 간격은 직전 확정 수행의 서울 날짜를 기준으로 하며 마지막 단계는 30일을 반복합니다. */
export function proposeInterval(stage:number,outcome:ReviewOutcome,conditions:ReviewConditions,now:Instant,timezone:SeoulTimezone):IntervalProposal {
  intervalStage.parse(stage);reviewConditions.parse(conditions);const today=seoulCalendarDate(now,timezone);
  const evidence=outcome.kind==="confirmed" ? confirmedReviewEvidence.parse(outcome.evidence) : null;
  if(evidence && evidence.confirmedAt>Date.parse(now)) throw domainFailure("validation","review.future-confirmation",null);
  const passed=evidence!==null && unassistedPass(evidence);
  const nextStage=passed ? Math.min(stage+1,4) : stage;
  const anchor=evidence ? seoulCalendarDate(new Date(evidence.confirmedAt).toISOString() as Instant,timezone) : today;
  const baseDays=intervals[nextStage];const retry=evidence!==null && !passed;
  const reasons:string[]=[retry ? "실패·도움·노출 또는 재시도는 단계 승격 없이 다음 서울 날짜 재확인을 제안해요." : passed ? "확정된 첫 독립 통과 근거로 다음 간격을 제안해요." : outcome.kind==="not-submitted" ? "미제출은 성공·실패로 평가하지 않으며 기존 단계에서 다시 날짜를 제안해요." : "첫 복습은 기본 1·3·7·14·30일 정책의 현재 단계에서 제안해요."];
  let adjustedDays=retry ? 1 : Math.min(baseDays,conditions.retentionDays);
  if(conditions.retentionDays<baseDays && !retry) reasons.push("희망 기억 유지 기간보다 간격이 길지 않도록 줄였어요.");
  if(conditions.goalDate!==null){const remaining=daysUntil(anchor,calendarDate.parse(conditions.goalDate));if(remaining<=0) reasons.push("목표일이 기준일 이전이거나 같아요. 다음 날짜 제안과 목표일이 충돌해 목표를 다시 확인해야 해요.");else if(remaining<adjustedDays){adjustedDays=remaining;reasons.push("목표일 전에 확인하도록 간격을 줄였어요.");}}
  const needsTime=conditions.availableMinutes<conditions.requiredMinutes;
  if(needsTime) reasons.push(`가용 ${conditions.availableMinutes}분이 필요한 ${conditions.requiredMinutes}분보다 적어요. 시간을 조정하기 전에는 일정 수락을 할 수 없어요.`);
  if(nextStage===4) reasons.push("마지막 단계 이후에는 30일을 반복 기준으로 사용하고 조건에 따라 다시 조정해요.");
  return intervalProposal.parse({policyVersion:"seoul-review-v1",anchorDate:anchor,stage:nextStage,baseDays,adjustedDays,dueDate:addCalendarDays(anchor,adjustedDays),conditions,reasons,needsTime,outcome:evidence ? passed ? "independent-pass" : "retry" : outcome.kind,evidence});
}
