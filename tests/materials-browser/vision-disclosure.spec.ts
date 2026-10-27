import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { z } from "zod";
import { materialBrowser, emptyMaterialLibrary, materialFixture } from "../fixtures/materials-scenario";
import { fixtureVisionBudget } from "../fixtures/vision-budget";
import { checkAccessibility } from "../fixtures/accessibility";
import type { UsageDashboard } from "../../lib/dashboard/usage";
import type { MaterialCard } from "../../lib/materials/library";
import type { StoredExtractionPage } from "../../lib/extraction/state";

const id: string = "00000000-0000-4000-a000-000000000603";
test("AI 전송 전 원장 조회 실패·소진·만료와 승인 범위 안내를 확인한다", async ({ page }, info): Promise<void> => {
  const png: Buffer = await readFile("tests/fixtures/pngsuite/basn2c08.png"); const sha256: string = createHash("sha256").update(png).digest("hex"); const base: MaterialCard = materialFixture(602);
  const material: MaterialCard = { ...base, metadata: { ...base.metadata, kind: "image", mime: "image/png", filename: "검증.png", bytes: png.length, sha256 }, file: { ...base.file, kind: "image", bytes: png.length, sha256 } };
  const saved: StoredExtractionPage = { id, jobId: id, selectionRevision: 1, filePage: 1, version: 1, resultVersion: 0, resultId: null, state: "pending", printedPage: null, pendingAiKey: null, pendingImage: null, resultImage: null, failure: null, confirmedSegmentIds: [], result: null };
  let failUsage: boolean = true; let usage: UsageDashboard = fixtureVisionBudget(Date.now()); let postCount: number = 0;
  await page.clock.install({ time: new Date(usage.asOf) });
  await materialBrowser(page, { ...emptyMaterialLibrary, materials: [material] }, async (route): Promise<void> => {
    const request = route.request(); const path: string = new URL(request.url()).pathname;
    if (path === "/api/dashboard/usage") { expect(request.method()).toBe("GET"); await route.fulfill(failUsage ? { status: 503, json: { error: "unavailable" } } : { json: usage }); return; }
    if (path.endsWith("/extraction")) { expect(request.method()).toBe("GET"); await route.fulfill({ json: { job: { jobId: id, revision: 1, uploadId: id, selection: { materialId: material.id, originalVersion: material.file.objectVersion, originalHash: sha256, pages: [{ filePage: 1, purpose: "study" }] } }, pages: [saved] } }); return; }
    if (path.endsWith("/vision")) {
      expect(request.method()).toBe("POST"); postCount++;
      const body = z.object({ filePage: z.literal(1), comparedWithOriginal: z.literal(true), image: z.object({ width: z.literal(32), height: z.literal(32), rotation: z.literal(0) }).passthrough() }).passthrough().parse(request.postDataJSON());
      expect(body.filePage).toBe(1);
      await route.fulfill({ json: { page: { ...saved, version: 2, state: "unknown", pendingAiKey: "synthetic-only" } } }); return;
    }
    expect(path).toBe(material.file.sourceUrl); expect(["GET", "HEAD"]).toContain(request.method()); await route.fulfill({ contentType: "image/png", body: request.method() === "HEAD" ? undefined : png });
  });
  await page.locator(".alter-material-row").click(); await page.getByRole("button", { name: "파일 1페이지 이미지 준비", exact: true }).click();
  const form = page.getByRole("form", { name: "파일 1페이지 AI 판독", exact: true }); const submit = form.getByRole("button", { name: "이 페이지 AI 판독", exact: true });
  await expect(form).toContainText("전송 대상: OpenAI · 이미지 한 장 · 32 × 32px"); await expect(submit).toBeDisabled();
  const read = form.getByRole("button", { name: "저장된 비용·승인 조건 확인", exact: true }); await read.click();
  await expect(form.getByRole("alert")).toContainText("비용 조회 실패"); await expect(submit).toBeDisabled(); expect(postCount).toBe(0);
  failUsage = false; usage = { ...usage, ai: { ...usage.ai, probeCommittedUsdMicros: 50_000 } }; await read.click();
  await expect(form).toContainText("누적 검증 상한에 도달"); await expect(submit).toBeDisabled();
  usage = fixtureVisionBudget(await page.evaluate((): number => Date.now())); await read.click();
  await expect(form).toContainText("남은 상한 US$0.008270"); await expect(form).toContainText("이 화면에서 승인을 확대하지 않아요"); await expect(form).toContainText("원화 청구 미확정"); await expect(submit).toBeEnabled();
  await page.clock.fastForward(300_000); await expect(submit).toBeDisabled(); await expect(form).toContainText("관측이 오래됐어요");
  usage = fixtureVisionBudget(await page.evaluate((): number => Date.now())); await read.click();
  await expect(submit).toBeEnabled(); await form.getByRole("checkbox").check();
  await checkAccessibility(page, ".alter-vision-form", info);
  await page.screenshot({ path: `outputs/ui-extraction/vision-cost-${info.project.name}.png`, fullPage: true });
  await submit.click(); await expect(form).toContainText("기존 판독 결과 확인이 먼저"); await expect(submit).toBeDisabled(); expect(postCount).toBe(1);
  expect(await page.pageErrors()).toEqual([]);
});
