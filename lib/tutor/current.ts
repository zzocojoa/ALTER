import { contentHash,domainFailure } from "../domain/contracts.ts";
import type { SiteIdentity } from "../domain/contracts.ts";
import type { TutorState } from "./contracts.ts";
import { inspectExtractionSource } from "../extraction/source-server.ts";
import { readConfirmedUnit } from "../../db/repositories/librarian-links.ts";
import { readCurrentTutorRecord,readCorrectedTutorReviews } from "../../db/repositories/tutor-start.ts";

/** 인출 중에도 서버는 소유자 원본과 정정 상태를 검사하며 본문을 화면에 노출하지 않습니다. */
export async function requireCurrentTutor(db:D1Database,bucket:R2Bucket,owner:SiteIdentity,state:TutorState):Promise<void> {
  const unit=await readConfirmedUnit(db,owner,state.start.bundle.unit.planVersionId,state.start.bundle.unit.unitId);
  const latest=await readCurrentTutorRecord(db,owner,unit.unitId);const reviews=await readCorrectedTutorReviews(db,owner,unit.courseId);
  if(await contentHash({unit,latest,reviews})!==await contentHash({unit:state.start.bundle.unit,latest:state.start.latest,reviews:state.start.reviews})) throw domainFailure("reference_conflict","tutor.plan-result-correction-changed",null);
  for(const source of state.start.bundle.sources) {
    const actual=await inspectExtractionSource(db,bucket,owner,source.id);
    if(!actual.valid || await contentHash(actual.source)!==await contentHash(source)) throw domainFailure("reference_conflict","tutor.source-version-span-changed",null);
  }
}
