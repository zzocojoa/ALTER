import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { materialBrowser, emptyMaterialLibrary, materialFixture } from "../fixtures/materials-scenario";
import type { MaterialCard } from "../../lib/materials/library";

type ImageProbeWindow = Window & typeof globalThis & { originalUrls: Set<string> };

test("사진 원본과 확대 창의 객체 URL은 닫을 때마다 해제한다", async ({ page }, info): Promise<void> => {
  const png: Buffer = await readFile("tests/fixtures/pngsuite/basn2c08.png");
  const base: MaterialCard = materialFixture(402);
  const material: MaterialCard = { ...base, metadata: { ...base.metadata, kind: "image", mime: "image/png", filename: "원본.png", bytes: png.length }, file: { ...base.file, kind: "image", bytes: png.length } };
  await page.addInitScript((): void => {
    const active: Set<string> = new Set<string>(); const create = URL.createObjectURL; const revoke = URL.revokeObjectURL;
    URL.createObjectURL = (blob: Blob | MediaSource): string => { const value: string = create(blob); active.add(value); return value; };
    URL.revokeObjectURL = (value: string): void => { active.delete(value); revoke(value); };
    (window as ImageProbeWindow).originalUrls = active;
  });
  await materialBrowser(page, { ...emptyMaterialLibrary, materials: [material] }, async (route): Promise<void> => {
    const request = route.request(); const path: string = new URL(request.url()).pathname; expect(["GET", "HEAD"]).toContain(request.method());
    if (path.endsWith("/extraction")) { await route.fulfill({ json: { job: null, pages: [] } }); return; }
    expect(path).toBe(material.file.sourceUrl); await route.fulfill({ contentType: "image/png", body: request.method() === "HEAD" ? undefined : png });
  });
  const urls = async (): Promise<number> => page.evaluate((): number => (window as ImageProbeWindow).originalUrls.size);
  for (let iteration: number = 0; iteration < 5; iteration++) {
    await page.locator(".alter-material-row").click();
    const preview = page.getByRole("region", { name: "선택한 자료", exact: true });
    await expect(preview.getByRole("img")).toBeVisible(); await expect.poll(urls).toBe(1);
    await preview.getByRole("button", { name: "사진 원본 크게 보기", exact: true }).click();
    const dialog = page.getByRole("dialog"); await expect(dialog.getByRole("img")).toBeVisible(); await expect.poll(urls).toBe(2);
    if (iteration === 0) {
      const region = dialog.getByRole("region", { name: "사진 이동 영역", exact: true });
      for (const dimensions of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
        await page.setViewportSize(dimensions);
        const bounds = await region.boundingBox();
        if (bounds === null) throw new Error("사진 원본 표시 영역이 없습니다.");
        await page.screenshot({ path: `outputs/ui-acceptance/W/image-fit-${info.project.name}-${dimensions.width}x${dimensions.height}.png` });
        expect(bounds.height).toBeGreaterThanOrEqual(dimensions.height * 0.55);
        await expect(region).toBeInViewport({ ratio: 1 });
        await expect(dialog.getByRole("button", { name: "자료로 돌아가기 · 확대 화면 닫기", exact: true })).toBeInViewport({ ratio: 1 });
      }
      await dialog.getByRole("button", { name: "원본 확대 한 단계", exact: true }).click();
      await expect(dialog.getByRole("slider", { name: "사진 확대", exact: true })).toHaveValue("125");
      await dialog.getByRole("button", { name: "125% · 크기 초기화", exact: true }).click();
      await expect(dialog.getByRole("slider", { name: "사진 확대", exact: true })).toHaveValue("100");
    }
    await page.keyboard.press("Escape"); await expect.poll(urls).toBe(1);
    await preview.getByRole("button", { name: "자료 목록으로", exact: true }).click(); await expect.poll(urls).toBe(0);
  }
  await info.attach("원본 객체 URL 정리", { body: JSON.stringify({ cycles: 5, remainingObjectUrls: await urls(), actualDevice: false }), contentType: "application/json" });
  expect(await page.pageErrors()).toEqual([]);
});
