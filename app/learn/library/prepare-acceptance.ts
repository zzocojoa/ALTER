import { z } from "zod";
import { confirmedUnit, linkInput, scopeInput, sourceExcerpt } from "@/lib/librarian/contracts";
import { STUDY_ACCEPTANCE_TEXT, STUDY_ACCEPTANCE_TITLE, STUDY_ACCEPTANCE_UPLOAD_KEY, LIBRARIAN_ACCEPTANCE_IDS, LIBRARIAN_ACCEPTANCE_LINK_ID, LIBRARIAN_HELP_ACCEPTANCE_ID, LIBRARIAN_HELP_LINK_ID } from "@/lib/librarian/acceptance-fixture";
import { selectionInput, buildSelection } from "@/lib/extraction/selection";
import { storedExtractionPage } from "@/lib/extraction/state";
import { materialMetadata } from "@/lib/materials/policy";
import { hashFile } from "@/lib/learning-upload";
import { extractPlainText } from "../materials/extract-text";
import { transferReply, requireMaterialResponse } from "../materials/client-api";
import { librarianJson, sourcesReply, scopeViewReply } from "./client-api";
import type { ScopeView } from "./client-api";

const contextReply = z.object({ unit: confirmedUnit,view: scopeViewReply.nullable() });
const extractionReply = z.object({ job: z.object({ jobId: z.string(),revision: z.number(),selection: selectionInput }).passthrough().nullable(),pages: z.array(storedExtractionPage) }).passthrough();
async function post(url: string, data: object, key: string): Promise<unknown> { return librarianJson(url,{ method: "POST",headers: { "content-type": "application/json","idempotency-key": key },body: JSON.stringify(data) }); }
/** 고정 자료의 원본 SHA와 정확한 텍스트를 대조한 뒤 실제 제품 API로만 연결합니다. 유료 호출은 별도입니다. */
export async function prepareLibrarianAcceptance(id: string): Promise<ScopeView> {
  z.enum(LIBRARIAN_ACCEPTANCE_IDS).parse(id);
  const context = contextReply.parse(await librarianJson("/api/librarian/acceptance?id="+encodeURIComponent(id),{ method: "GET" }));
  if (context.view) return context.view;
  const bytes: Uint8Array<ArrayBuffer> = new TextEncoder().encode(STUDY_ACCEPTANCE_TEXT);
  const metadata = materialMetadata.parse({ title: STUDY_ACCEPTANCE_TITLE,edition: "시험 1판",role: "textbook",kind: "text",filename: "alter-fractions-test.txt",mime: "text/plain",bytes: bytes.length,sha256: await hashFile(bytes.buffer) });
  await post("/api/materials/storage-check",{},crypto.randomUUID());
  let transfer = transferReply.parse(await post("/api/materials/uploads",{ courseId: context.unit.courseId,metadata },STUDY_ACCEPTANCE_UPLOAD_KEY));
  if (transfer.state === "reserved") transfer = transferReply.parse(await librarianJson(`/api/materials/uploads/${transfer.id}/body`,{ method: "PUT",headers: { "content-type": "text/plain","x-upload-version": String(transfer.version) },body: bytes }));
  if (transfer.state === "stored") transfer = transferReply.parse(await post(`/api/materials/uploads/${transfer.id}/complete`,{ expectedVersion: transfer.version },crypto.randomUUID()));
  if (transfer.state !== "registered") throw new Error(`시험 자료 상태가 ${transfer.state}입니다. 자료 보관함에서 기존 전송을 확인해 주세요.`);
  const choices = sourcesReply.parse(await librarianJson(`/api/librarian/sources?materialId=${transfer.materialId}`,{ method: "GET" }));
  const original = await fetch(choices.material.file.sourceUrl,{ cache: "no-store" }); await requireMaterialResponse(original);
  if (await hashFile(await original.arrayBuffer()) !== metadata.sha256) throw new Error("시험 자료 원본 해시가 다릅니다.");
  let extraction = extractionReply.parse(await librarianJson(`/api/materials/${transfer.materialId}/extraction`,{ method: "GET" }));
  if (!extraction.job) extraction = extractionReply.parse(await post(`/api/materials/${transfer.materialId}/extraction`,{ expectedRevision: 0,selection: buildSelection(choices.material.file,"","1") },"00000000-0000-4000-a000-000000000811"));
  if (!extraction.job || extraction.job.revision !== 1 || extraction.pages.length !== 1) throw new Error("시험 자료 선택이 변경됐어요. 기존 선택을 확인해 주세요.");
  let page = extraction.pages[0]; const base: string = `/api/materials/${transfer.materialId}/extraction/pages/${page.id}`;
  if (page.state === "pending") {
    const result = await extractPlainText(choices.material,extraction.job,new AbortController().signal);
    page = z.object({ page: storedExtractionPage }).passthrough().parse(await post(`${base}/text`,{ selectionRevision: 1,filePage: 1,expectedVersion: page.version,result },"00000000-0000-4000-a000-000000000812")).page;
  }
  if (page.result?.segments.length !== 1 || page.result.segments[0].text !== STUDY_ACCEPTANCE_TEXT || page.resultId === null) throw new Error("시험 원문과 추출 결과가 일치하지 않아요.");
  if (!page.confirmedSegmentIds.includes("s0")) page = z.object({ page: storedExtractionPage }).passthrough().parse(await post(`${base}/confirm`,{ selectionRevision: 1,filePage: 1,expectedVersion: page.version,resultId: page.resultId,segmentIds: ["s0"],printedPage: null,comparedWithOriginal: true },"00000000-0000-4000-a000-000000000813")).page;
  const source = z.object({ valid: z.literal(true),source: sourceExcerpt }).passthrough().parse(await post(`${base}/sources`,{ selectionRevision: 1,filePage: 1,expectedVersion: page.version,segmentId: "s0" },"00000000-0000-4000-a000-000000000814")).source;
  const linkId: string = id === LIBRARIAN_HELP_ACCEPTANCE_ID ? LIBRARIAN_HELP_LINK_ID : LIBRARIAN_ACCEPTANCE_LINK_ID;
  const link = linkInput.parse({ id: linkId,planVersionId: context.unit.planVersionId,unitId: context.unit.unitId,materialId: transfer.materialId,toc: "분수의 뜻과 같은 분모 덧셈",sourceRefIds: [source.id],bibliography: { author: "ALTER",origin: "자체 작성 시험 자료",checked: true,evidenceSourceId: source.id },readingMinutes: 5 });
  await post("/api/librarian",{ action: "link",link },linkId);
  const input = scopeInput.parse({ id,planVersionId: context.unit.planVersionId,unitId: context.unit.unitId,date: id === LIBRARIAN_HELP_ACCEPTANCE_ID ? "2026-10-26" : "2026-10-24",availableMinutes: 30,questionMinutes: 5,practiceMinutes: 10,linkIds: [linkId] });
  return scopeViewReply.parse(await post("/api/librarian",{ action: "start",input },id));
}
