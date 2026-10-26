import { reviewOverview } from "../../lib/reviews/view.ts";
import type { ReviewOverview } from "../../lib/reviews/view.ts";
import { domainFailure } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import { readReviewPlans } from "./review-policy.ts";
import { readStorage } from "./atomic.ts";
import type { Instant,SeoulTimezone } from "../../lib/reviews/calendar.ts";
import { seoulCalendarDate } from "../../lib/reviews/calendar.ts";
export async function requireReviewVisibility(db:D1Database,owner:SiteIdentity):Promise<void> {
  const count=await readStorage("review.visibility",()=>db.prepare("SELECT count(*) AS n FROM attempts WHERE owner_id=? AND status='awaiting-answer' AND hidden_material=1").bind(owner.userId).first<number>("n"));
  if(count===null) throw domainFailure("storage_failure","review.visibility-count",null);if(count>0) throw domainFailure("reference_conflict","review.hidden-recall-active",null);
}
export async function readReviewOverview(db:D1Database,owner:SiteIdentity,now:Instant,timezone:SeoulTimezone):Promise<ReviewOverview> {
  await requireReviewVisibility(db,owner);const plans=await readReviewPlans(db,owner,now,timezone);
  const legacy=await readStorage("review.legacy-targets",()=>db.prepare("SELECT r.id,r.version,u.title FROM result_review_targets t JOIN review_items r ON r.owner_id=t.owner_id AND r.id=t.review_id JOIN errors e ON e.owner_id=r.owner_id AND e.id=r.error_id JOIN units u ON u.owner_id=e.owner_id AND u.id=e.unit_id WHERE t.owner_id=? AND NOT EXISTS(SELECT 1 FROM review_plans p WHERE p.owner_id=r.owner_id AND p.id=r.id) ORDER BY r.rowid DESC LIMIT 201").bind(owner.userId).all());
  if(legacy.results.length>200) throw domainFailure("limit_exceeded","review.legacy-list-requires-narrowing",null);await requireReviewVisibility(db,owner);
  return reviewOverview.parse({today:seoulCalendarDate(now,timezone),plans,legacy:legacy.results});
}
