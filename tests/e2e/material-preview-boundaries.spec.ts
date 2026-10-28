import { createHash, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { MaterialCard, MaterialLibrary } from "../../lib/materials/library";
import { sizedPdf, pageTreePdf } from "../fixtures/pdf-bytes";

for (const fixture of [{ title: "20MiB 원본", pages: 1 }, { title: "500페이지 원본", pages: 500 }]) {
  test(`${fixture.title}을 한 페이지씩 표시하고 닫는다`, async ({ page }, info): Promise<void> => {
    const pdf: Uint8Array = fixture.pages === 1 ? sizedPdf(20 * 1048576) : pageTreePdf(500, 500);
    const id: string = randomUUID(); const courseId: string = randomUUID(); const sha256: string = createHash("sha256").update(pdf).digest("hex");
    const material: MaterialCard = { id, courseId, metadata: { title: fixture.title, edition: "", role: "textbook", kind: "pdf", filename: "boundary.pdf", mime: "application/pdf", bytes: pdf.length, sha256 }, file: { materialId: id, kind: "pdf", role: "textbook", bytes: pdf.length, pages: fixture.pages, sha256, objectVersion: "boundary", sourceUrl: `/api/materials/${id}/file` } };
    const library: MaterialLibrary = { materials: [material], courses: [{ id: courseId, title: "크기 경계 검증" }], pending: [], usage: null, hidden: false, hasMore: false, cursor: null };
    const writes: string[] = [];
    await page.goto("/signin-with-chatgpt?return_to=/learn/materials");
    page.on("request", (request): void => { if (!["GET", "HEAD"].includes(request.method())) writes.push(request.method()); });
    await page.route("**/api/materials", async (route): Promise<void> => { await route.fulfill({ json: library }); });
    await page.route("**/api/materials/*/extraction", async (route): Promise<void> => { await route.fulfill({ json: { job: null, pages: [] } }); });
    await page.route("**/api/materials/*/file", async (route): Promise<void> => {
      const range: string | undefined = route.request().headers().range; const match: RegExpExecArray | null = range === undefined ? null : /^bytes=(\d+)-(\d+)$/.exec(range);
      const start: number = match === null ? 0 : Number(match[1]); const end: number = match === null ? pdf.length - 1 : Math.min(Number(match[2]), pdf.length - 1);
      const headers: Record<string, string> = { "content-type": "application/pdf", etag: '"boundary"', "accept-ranges": "bytes", "content-length": String(end - start + 1) };
      if (match !== null) headers["content-range"] = `bytes ${start}-${end}/${pdf.length}`;
      await route.fulfill({ status: match === null ? 200 : 206, headers, body: route.request().method() === "HEAD" ? undefined : Buffer.from(pdf.slice(start, end + 1)) });
    });
    await page.getByRole("button", { name: "목록 새로 확인", exact: true }).click(); await page.locator(`#material-${id}`).click();
    const preview = page.getByRole("region", { name: "선택한 자료", exact: true });
    await expect(preview.getByText("1페이지를 열었어요.", { exact: true })).toBeVisible();
    if (fixture.pages > 1) { await preview.getByLabel("파일 페이지", { exact: true }).fill("500"); await expect(preview.getByText("500페이지를 열었어요.", { exact: true })).toBeVisible(); }
    await expect(preview.locator("canvas")).toHaveCount(1);
    const pixels = await preview.locator("canvas").evaluate((element: HTMLCanvasElement): number => element.width * element.height);
    expect(pixels).toBeLessThanOrEqual(4000000);
    await page.screenshot({ path: `outputs/ui-original/boundary-${fixture.pages}-${info.project.name}.png` });
    await preview.getByRole("button", { name: "자료 목록으로", exact: true }).click(); await expect(page.locator("canvas")).toHaveCount(0);
    expect(writes).toEqual([]); expect(await page.pageErrors()).toEqual([]);
    await info.attach("대용량 원본 경계", { body: JSON.stringify({ bytes: pdf.length, pages: fixture.pages, renderedPage: fixture.pages, maximumCanvasPixels: pixels, source: "synthetic-original-with-real-pdfjs", actualDevice: false }), contentType: "application/json" });
  });
}
