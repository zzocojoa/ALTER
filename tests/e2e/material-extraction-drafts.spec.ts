import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { expect, test } from "@playwright/test";
import { readablePdf } from "../fixtures/pdf-bytes";
import { checkAccessibility } from "../fixtures/accessibility";
import type { MaterialCard, MaterialLibrary } from "../../lib/materials/library";
import type { StoredExtractionPage } from "../../lib/extraction/state";

/** 저장 응답만 합성하고 PDF 표시·폼 상태·페이지 이동은 실제 UI로 검증합니다. */
function extractionPage(id: string, filePage: number): StoredExtractionPage {
  return { id, jobId: id, selectionRevision: 1, filePage, version: 2, resultVersion: 1, resultId: id, state: "complete", printedPage: null, pendingAiKey: null, pendingImage: null, resultImage: null, failure: null, confirmedSegmentIds: [], result: { filePage, method: "text-layer", status: "complete", width: 612, height: 792, rotation: 0, segments: [{ id: "s0", kind: "text", text: `파일 ${filePage}의 확인 전 문장`, bounds: { x: 0.1, y: 0.1, width: 0.5, height: 0.1 }, transform: null, uncertain: true, reason: "원본 대조 필요" }], error: null, requiresConfirmation: true } };
}

test("쪽수 저장·페이지 이동은 수정 초안을 보존하고 새 결과 판은 확인 선택을 넘겨받지 않는다", async ({ page }, info): Promise<void> => {
  const pdf: Uint8Array = readablePdf(3); const materialId: string = randomUUID(); const courseId: string = randomUUID(); const id: string = randomUUID(); const sourceId: string = randomUUID();
  const sha256: string = createHash("sha256").update(pdf).digest("hex");
  const material: MaterialCard = { id: materialId, courseId, metadata: { title: "서지와 본문 구분 검증", edition: "등록 판본", role: "textbook", kind: "pdf", filename: "drafts.pdf", mime: "application/pdf", bytes: pdf.length, sha256 }, file: { materialId, kind: "pdf", role: "textbook", bytes: pdf.length, pages: 3, sha256, objectVersion: "fixture", sourceUrl: `/api/materials/${materialId}/file` } };
  const library: MaterialLibrary = { materials: [material], courses: [{ id: courseId, title: "검증 과정" }], pending: [], usage: null, hidden: false, hasMore: false, cursor: null };
  let first: StoredExtractionPage = extractionPage(id, 1); const third: StoredExtractionPage = extractionPage(randomUUID(), 3);
  const originalResultId: string | null = first.resultId; const posts: string[] = [];
  const job = { jobId: id, revision: 1, uploadId: id, selection: { materialId, originalVersion: "fixture", originalHash: sha256, pages: [{ filePage: 1, purpose: "study" }, { filePage: 3, purpose: "study" }] } };
  await page.goto("/signin-with-chatgpt?return_to=/learn/materials");
  await page.route("**/api/materials", async (route): Promise<void> => { expect(route.request().method()).toBe("GET"); await route.fulfill({ json: library }); });
  await page.route("**/api/materials/*/file", async (route): Promise<void> => { expect(["GET", "HEAD"]).toContain(route.request().method()); await route.fulfill({ headers: { "content-type": "application/pdf", etag: '"fixture"', "content-length": String(pdf.length) }, body: route.request().method() === "HEAD" ? undefined : Buffer.from(pdf) }); });
  await page.route("**/api/materials/*/extraction**", async (route): Promise<void> => {
    const request = route.request(); const path: string = new URL(request.url()).pathname;
    if (request.method() === "GET") { expect(path).toBe(`/api/materials/${materialId}/extraction`); await route.fulfill({ json: { job, pages: [first, third] } }); return; }
    expect(request.method()).toBe("POST"); posts.push(path);
    const raw: unknown = request.postDataJSON();
    const binding = z.object({ selectionRevision: z.number(), filePage: z.number(), expectedVersion: z.number() }).passthrough().parse(raw);
    expect(binding.selectionRevision).toBe(1); expect(binding.filePage).toBe(1); expect(binding.expectedVersion).toBe(first.version);
    if (path.endsWith("/label")) { const body = z.object({ printedPage: z.string() }).passthrough().parse(raw); expect(body.printedPage).toBe("iii"); first = { ...first, version: first.version + 1, printedPage: body.printedPage }; }
    else if (path.endsWith("/edit")) {
      const body = z.object({ resultId: z.string().uuid(), segments: z.array(z.object({ id: z.string(), text: z.string() })) }).passthrough().parse(raw);
      expect(body.resultId).toBe(originalResultId); expect(body.segments).toEqual([{ id: "s0", text: "아직 저장 전인 정정 문장" }]);
      if (first.result === null) throw new Error("검증 결과가 없습니다.");
      first = { ...first, version: first.version + 1, resultVersion: first.resultVersion + 1, resultId: randomUUID(), confirmedSegmentIds: [], result: { ...first.result, method: "manual-correction", segments: [{ ...first.result.segments[0], text: body.segments[0].text }] } };
    } else if (path.endsWith("/confirm")) { const body = z.object({ resultId: z.string().uuid(), segmentIds: z.array(z.string()), comparedWithOriginal: z.boolean() }).passthrough().parse(raw); expect(body.resultId).toBe(first.resultId); expect(body.segmentIds).toEqual(["s0"]); expect(body.comparedWithOriginal).toBe(true); first = { ...first, version: first.version + 1, confirmedSegmentIds: ["s0"] }; }
    else if (path.endsWith("/sources")) { const body = z.object({ segmentId: z.string() }).passthrough().parse(raw); expect(body.segmentId).toBe("s0"); await route.fulfill({ json: { valid: true, source: { id: sourceId, filePage: 1, printedPage: "iii", evidence: "아직 저장 전인 정정 문장" } } }); return; }
    else throw new Error(`허용하지 않은 로컬 검증 요청: ${path}`);
    await route.fulfill({ json: { page: first } });
  });
  await page.getByRole("button", { name: "목록 새로 확인", exact: true }).click(); await page.locator(`#material-${materialId}`).click();
  const comparison = page.getByRole("region", { name: "원본과 결과 비교", exact: true });
  await expect(comparison.getByRole("complementary", { name: "등록 정보와 서지 확인" })).toContainText("등록 정보는 추출한 본문이 아니에요");
  const label = comparison.getByRole("textbox", { name: "인쇄된 쪽수", exact: true });
  await label.fill("iii");
  await comparison.getByText("추출 내용 수정", { exact: true }).click();
  const correction = comparison.getByRole("textbox", { name: "구간 1 수정", exact: true }); await correction.fill("아직 저장 전인 정정 문장");
  const checked = comparison.getByRole("checkbox", { name: "구간 1 확인", exact: true }); await checked.check();
  const compared = comparison.getByRole("checkbox", { name: "선택한 구간을 이 파일 페이지의 원본과 대조했어요.", exact: true }); await compared.check();
  await comparison.getByRole("button", { name: "쪽수 저장", exact: true }).click(); await expect(label).toBeEnabled();
  await expect(correction).toHaveValue("아직 저장 전인 정정 문장"); await expect(checked).toBeChecked(); await expect(compared).toBeChecked();
  await comparison.getByRole("button", { name: "파일 3페이지 결과", exact: true }).click();
  await label.fill("5"); await comparison.getByText("추출 내용 수정", { exact: true }).click(); await correction.fill("3쪽 수정 초안");
  await comparison.getByRole("button", { name: "파일 1페이지 결과", exact: true }).click(); await comparison.getByText("추출 내용 수정", { exact: true }).click();
  await expect(label).toHaveValue("iii"); await expect(correction).toHaveValue("아직 저장 전인 정정 문장"); await expect(checked).toBeChecked();
  await comparison.getByRole("button", { name: "수정본 저장", exact: true }).click();
  await expect(comparison.getByRole("heading", { name: "파일 1페이지 · 결과 2판", exact: true })).toBeVisible(); await expect(label).toHaveValue("iii");
  await expect(checked).not.toBeChecked(); await expect(compared).not.toBeChecked(); await expect(comparison.getByRole("button", { name: "확인 구간 출처 연결", exact: true })).toHaveCount(0);
  await checked.check(); await compared.check(); await comparison.getByRole("button", { name: "선택 구간 확인 저장", exact: true }).click();
  await comparison.getByRole("button", { name: "확인 구간 출처 연결", exact: true }).click();
  await expect(comparison.getByRole("link", { name: "연결한 원본 구간 보기", exact: true })).toHaveAttribute("href", `/learn/source/${sourceId}`);
  await label.fill("iv"); await correction.fill("충돌해도 보관할 초안");
  if (first.result === null) throw new Error("검증 결과가 없습니다.");
  first = { ...first, version: first.version + 1, resultVersion: 3, resultId: randomUUID(), confirmedSegmentIds: [], result: { ...first.result, segments: [{ ...first.result.segments[0], text: "외부에서 저장된 최신 결과" }] } };
  await page.getByRole("button", { name: "저장 상태 다시 확인", exact: true }).click();
  await expect(comparison.getByRole("alert")).toContainText("이전 초안은 보관"); await expect(correction).toHaveValue("충돌해도 보관할 초안"); await expect(label).toHaveValue("iv");
  await expect(comparison.getByRole("button", { name: "수정본 저장", exact: true })).toBeDisabled();
  await expect(comparison.getByRole("link", { name: "연결한 원본 구간 보기", exact: true })).toHaveCount(0);
  await comparison.getByRole("button", { name: "보관 초안을 지우고 최신 결과로 수정 시작", exact: true }).click();
  await expect(correction).toHaveValue("외부에서 저장된 최신 결과"); await expect(label).toHaveValue("iv");
  await comparison.getByRole("button", { name: "파일 3페이지 결과", exact: true }).click(); await comparison.getByText("추출 내용 수정", { exact: true }).click();
  await expect(label).toHaveValue("5"); await expect(correction).toHaveValue("3쪽 수정 초안");
  await checkAccessibility(page, ".extraction-review", info); expect(posts).toHaveLength(4);
  expect(await page.pageErrors()).toEqual([]);
  await page.screenshot({ path: `outputs/ui-extraction/drafts-${info.project.name}.png`, fullPage: true });
});
