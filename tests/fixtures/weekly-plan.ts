import { roommateFixture } from "./weekly-roommate";
import { aggregateWeeklyEvidence } from "../../lib/weekly/evidence";
import { supportedWeeklyClaims } from "../../lib/weekly/claims";
import type { WeeklyPlanningContext,WeeklyProposal } from "../../lib/weekly/planning";
import { weeklyEvidenceFixture } from "./weekly-evidence";

export async function weeklyPlanFixture():Promise<Readonly<{context:WeeklyPlanningContext;proposal:WeeklyProposal}>> {
  const input=weeklyEvidenceFixture();const aggregate=await aggregateWeeklyEvidence(input);const unit=input.sessions[0].state.start.bundle.unit;const sources=input.sessions[0].state.start.bundle.sources;
  const claims=supportedWeeklyClaims(aggregate,sources.map(source=>source.id));const independent=claims.find(claim=>claim.kind==="independent-new-condition");if(!independent) throw new Error("주간 계획 픽스처 독립 수행 누락");
  return {context:{aggregate,units:[unit],sources,availableMinutes:30},proposal:{kind:"weekly-review",claimIds:claims.map(claim=>claim.id),items:[{unitId:unit.unitId,targetUnitId:unit.unitId,action:"increase-difficulty",estimatedMinutes:20,activity:"새로운 조각 조건에서 분수를 설명하고 풀이하기",claimIds:[independent.id]}],roommate:roommateFixture(unit.unitId,sources),uncertainty:["예상 시간이며 실제 수행 난도는 다음 답안으로 확인해야 해요."],requiresConfirmation:true}};
}
