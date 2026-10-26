import { z } from "zod";
import { domainFailure,recordId } from "../domain/contracts.ts";
import { requireSourceQuote } from "../librarian/citations.ts";
import type { SourceExcerpt } from "../librarian/contracts.ts";

const text=z.string().min(1).max(2000).regex(/\S/);
export const roommateFact=z.object({content:text,status:z.enum(["source-checked","unverified"]),sourceRefId:recordId.nullable(),quote:text.nullable()}).strict();
export const roommateExplanation=z.object({unitId:recordId,learningDomain:text,facts:z.array(roommateFact).min(1).max(6),analogy:z.object({otherDomain:text,example:text,similarities:z.array(text).min(1).max(4),differences:z.array(text).min(1).max(4),limitations:z.array(text).min(1).max(4),appliesUniversally:z.literal(false),distinction:z.literal("analogy-not-established-fact")}).strict()}).strict();
export type RoommateExplanation=Readonly<z.infer<typeof roommateExplanation>>;
/** 출처 확인은 정확한 원문 확인만 뜻하며 비유나 모델 해석을 검증된 사실로 올리지 않습니다. */
export function validateRoommate(value:RoommateExplanation,sources:readonly SourceExcerpt[],unitIds:readonly string[]):void {
  const explanation=roommateExplanation.parse(value);
  if(!unitIds.includes(explanation.unitId)) throw domainFailure("reference_conflict","weekly.roommate-unit",{unitId:explanation.unitId});
  if(explanation.learningDomain.trim().toLocaleLowerCase()===explanation.analogy.otherDomain.trim().toLocaleLowerCase()) throw domainFailure("validation","weekly.roommate-different-domain",null);
  for(const fact of explanation.facts) {
    if(fact.status==="source-checked" && (!fact.sourceRefId || !fact.quote || fact.content!==fact.quote)) throw domainFailure("reference_conflict","weekly.roommate-checked-fact-quote",{sourceRefId:fact.sourceRefId});
    if((fact.sourceRefId===null)!==(fact.quote===null)) throw domainFailure("validation","weekly.roommate-incomplete-citation",{sourceRefId:fact.sourceRefId});
    if(fact.sourceRefId!==null && fact.quote!==null) requireSourceQuote(sources,fact.sourceRefId,fact.quote,"weekly.roommate-source-quote");
  }
}
