import { domainFailure } from "../domain/contracts.ts";
import type { SourceExcerpt } from "./contracts.ts";

/** 확인된 선택 원문의 식별자와 정확한 인용 구간을 함께 검사합니다. */
export function requireSourceQuote(sources:readonly SourceExcerpt[],sourceRefId:string,quote:string,operation:string):void {
  if(quote.trim().length===0 || !sources.some(source=>source.id===sourceRefId && source.evidence.includes(quote))) throw domainFailure("reference_conflict",operation,{sourceRefId});
}
