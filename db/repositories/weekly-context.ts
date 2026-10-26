import { z } from "zod";
import { contentHash,domainFailure,recordId } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import { sourceExcerpt } from "../../lib/librarian/contracts.ts";
import { inspectExtractionSource } from "../../lib/extraction/source-server.ts";
import { readWeeklyEvidence } from "./weekly-evidence.ts";
import type { WeeklyEvidenceSnapshot } from "./weekly-evidence.ts";

export const weeklySourceCheck=z.object({id:recordId,valid:z.boolean(),reason:z.string().nullable(),source:sourceExcerpt.nullable()}).strict();
export type WeeklySourceCheck=Readonly<z.infer<typeof weeklySourceCheck>>;
export type WeeklyContext=Readonly<{snapshot:WeeklyEvidenceSnapshot;sources:readonly WeeklySourceCheck[];fingerprint:string}>;
/** 인출 보호가 적용된 주간 증거를 읽은 뒤 기존 원본·추출 확인 어댑터로 출처를 재검증합니다. */
export async function readWeeklyContext(db:D1Database,bucket:R2Bucket,owner:SiteIdentity,courseId:string,date:string):Promise<WeeklyContext> {
  const snapshot=await readWeeklyEvidence(db,owner,courseId,date);
  const expected=[...new Map(snapshot.sessions.flatMap(item=>item.state.start.bundle.sources).map(item=>[item.id,item])).values()];
  if(expected.length>200) throw domainFailure("limit_exceeded","weekly.source-range-too-large",null);
  const sources:WeeklySourceCheck[]=[];
  for(const source of expected) {
    const inspected=await inspectExtractionSource(db,bucket,owner,source.id);
    const same=inspected.valid && await contentHash(inspected.source)===await contentHash(source);
    sources.push({id:source.id,valid:same,reason:!inspected.valid ? inspected.reason : same ? null : "confirmed-source-changed",source:same && inspected.valid ? sourceExcerpt.parse(inspected.source) : null});
  }
  return {snapshot,sources,fingerprint:await contentHash({revision:snapshot.revision,sources})};
}
