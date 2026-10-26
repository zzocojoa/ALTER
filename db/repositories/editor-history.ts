import { contentHash } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import type { TutorState } from "../../lib/tutor/contracts.ts";
import { inspectExtractionSource } from "../../lib/extraction/source-server.ts";
import { editorFeedbackRechecks,feedbackSourceIds } from "../../lib/editor/history.ts";
import type { EditorRecheck } from "../../lib/editor/history.ts";
import { readConfirmedUnit } from "./librarian-links.ts";
import { readCurrentTutorRecord,readCorrectedTutorReviews } from "./tutor-start.ts";
import { isDomainFailure } from "./atomic.ts";
export async function readEditorRechecks(db:D1Database,bucket:R2Bucket,owner:SiteIdentity,state:TutorState):Promise<readonly EditorRecheck[]> {
  const ids=[...new Set((state.editor?.feedbacks ?? []).flatMap((feedback)=>feedbackSourceIds(state,feedback)))];
  const checked=await Promise.all(ids.map(async (id):Promise<Readonly<{id:string;valid:boolean}>>=>{const actual=await inspectExtractionSource(db,bucket,owner,id);const original=state.start.bundle.sources.find((source)=>source.id===id);return {id,valid:actual.valid && original!==undefined && await contentHash(actual.source)===await contentHash(original)};}));
  let criterionChanged:boolean;
  try {const unit=await readConfirmedUnit(db,owner,state.start.bundle.unit.planVersionId,state.start.bundle.unit.unitId);criterionChanged=await contentHash(unit)!==await contentHash(state.start.bundle.unit);}catch(error:unknown){if(!isDomainFailure(error) || error.code!=="reference_conflict") throw error;criterionChanged=true;}
  const current=await readCurrentTutorRecord(db,owner,state.start.bundle.unit.unitId);const reviews=await readCorrectedTutorReviews(db,owner,state.start.bundle.unit.courseId);
  const correctedSources=reviews.filter((review)=>review.correctionId!==null && !state.start.reviews.some((old)=>old.id===review.id && old.correctionId===review.correctionId && old.version===review.version)).map((review)=>review.sourceRefId);
  return editorFeedbackRechecks(state,[...checked.filter((item)=>!item.valid).map((item)=>item.id),...correctedSources.filter((id):id is NonNullable<typeof id>=>id!==null)],criterionChanged,current?.correctionId ?? null);
}
