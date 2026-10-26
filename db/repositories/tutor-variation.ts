import { domainFailure } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import type { TutorState,TutorVariation } from "../../lib/tutor/contracts.ts";
import { finishTutorVariation } from "../../lib/tutor/variation.ts";
import { requireCurrentTutor } from "../../lib/tutor/current.ts";
import { saveTutorTransition,tutorEvidenceGuards } from "./tutor.ts";
import type { Receipt } from "./atomic.ts";
export async function saveStoredTutorVariation(db:D1Database,bucket:R2Bucket,owner:SiteIdentity,previous:TutorState,output:TutorVariation):Promise<Receipt> {
  if(!previous.pending) throw domainFailure("version_conflict","tutor.variation-request",null);await requireCurrentTutor(db,bucket,owner,previous);
  const next=finishTutorVariation(previous,output,crypto.randomUUID(),crypto.randomUUID());const relation=next.variations.at(-1);if(!relation) throw domainFailure("reference_conflict","tutor.variation-relation",null);
  return saveTutorTransition(db,{owner,requestKey:`${previous.pending.key}:complete`,expectedVersion:previous.version},next,"variation-complete",output,(requestId)=>[
    ...tutorEvidenceGuards(db,owner,next,requestId),
    db.prepare("INSERT INTO questions VALUES (?,?,?,?,?)").bind(owner.userId,next.question.id,next.id,next.question.sourceRefIds[0],next.question.prompt),
    db.prepare("INSERT INTO attempts VALUES (?,?,1,?,?,?,?, 'new-condition',1,'awaiting-answer')").bind(owner.userId,next.question.attemptId,requestId,next.id,next.question.id,next.question.originalQuestionId),
    db.prepare("INSERT INTO tutor_variations VALUES (?,?,?,?)").bind(owner.userId,next.question.id,previous.question.id,JSON.stringify(relation)),
  ]);
}
