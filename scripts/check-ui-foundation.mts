import { build } from "vite";
import { chromium, expect, type Page } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BookOpen } from "lucide-react";

const outputDirectory: string = ".sites-runtime/ui-foundation";
await build({ configFile: false, logLevel: "warn", build: { outDir: outputDirectory, emptyOutDir: true, lib: { entry: "tests/fixtures/ui-foundation.ts", formats: ["es"], fileName: "fixture", cssFileName: "fixture" } } });
const legacy: string = await readFile(outputDirectory + "/fixture.css", "utf8");
const tokens: string = await readFile("app/styles/tokens.css", "utf8");
const foundation: string = await readFile("app/styles/foundation.css", "utf8");
const newStyles: string = tokens + "\n" + foundation;
const icon: string = renderToStaticMarkup(createElement(BookOpen, { className: "alter-icon", "aria-hidden": true, focusable: false }));
const markup: string = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>UI 스타일 경계 검증</title><body>
<main>
<section class="site-shell" id="public"><h1>기존 공개 화면</h1><a href="#public" class="storage-check-button">로그인</a><p>학습 공간 안내입니다.</p></section>
<section class="site-shell" id="quarantine"><h1>복원을 확인하고 있어요</h1><p>자료 복원 완료 전까지 기다려 주세요.</p></section>
<section class="material-page" id="legacy"><h2>기존 자료 화면</h2><label>자료 이름<input value="분수의 의미"></label><button type="button">기존 등록</button><div class="extraction-panel"><button type="button">기존 추출</button></div></section>
<section class="tutor-panel material-page" id="mixed"><div data-alter-ui class="alter-view">
<a class="alter-link" id="selected-link" href="#mixed" aria-current="page">${icon}학습</a><a class="alter-link" id="plain-link" href="#public">${icon}오늘</a><h2 class="alter-heading" tabindex="-1">새 학습 화면</h2><h1 class="alter-heading" id="long-heading">자신의말로설명하는분수의의미와새로운조건의문제를해결하는매우긴학습제목입니다</h1><p class="alter-body">같은 크기로 나눈 전체 중 일부를 설명합니다.</p><a class="alter-url" id="long-url" href="#long-heading">https://example.invalid/very-long-learning-material-reference-without-any-natural-line-break-opportunities-1234567890</a><p class="alter-number" id="number">10,000원 · US$0.300000</p><pre class="alter-math" id="math" tabindex="0" aria-label="가로로 이동해 읽는 수식">1/4 + 2/4 + 3/4 + 4/4 + 5/4 + 6/4 + 7/4 + 8/4 = 36/4</pre><button class="alter-control" id="control" type="button">답안 저장</button><label>새 답안<input class="alter-control" id="field" value="입력 보존"></label>
<div hidden class="flex grid" id="hidden"><button type="button">숨긴 정답</button></div><div inert id="inert"><button type="button" id="inert-button">잠긴 동작</button></div>
<button class="alter-control" disabled id="disabled" type="button">아직 제출할 수 없어요</button>
</div></section></main>
<div data-alter-ui id="portal"><button type="button" class="alter-control" id="portal-control">포털 닫기</button></div></body></html>`;

type StyleSnapshot = Readonly<{ selector: string; color: string; background: string; font: string; padding: string; border: string; display: string; outline: string; }>;
async function legacySnapshot(page: Page): Promise<readonly StyleSnapshot[]> {
  return page.locator("#public h1, #public a, #public p, #quarantine h1, #quarantine p, #legacy h2, #legacy input, #legacy button").evaluateAll((elements): readonly StyleSnapshot[] => elements.map((element, index): StyleSnapshot => {
    const style: CSSStyleDeclaration = getComputedStyle(element);
    return { selector: element.tagName + ":" + index, color: style.color, background: style.backgroundColor, font: style.font, padding: style.padding, border: style.border, display: style.display, outline: style.outline };
  }));
}

type PixelComparison = Readonly<{ name: string; width: number; height: number; changedPixels: number; differingPixels: number; maxChannelDifference: number; channelTolerance: number; }>;
async function comparePixels(page: Page, name: string): Promise<PixelComparison> {
  const before: string = "data:image/png;base64," + (await readFile("outputs/ui-foundation/" + name + "-before.png")).toString("base64");
  const after: string = "data:image/png;base64," + (await readFile("outputs/ui-foundation/" + name + "-after.png")).toString("base64");
  const result = await page.evaluate(async ({ before, after }): Promise<Omit<PixelComparison, "name">> => {
    const images: ImageData[] = [];
    for (const src of [before, after]) {
      const image: HTMLImageElement = new Image();
      image.src = src;
      await image.decode();
      const canvas: HTMLCanvasElement = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context: CanvasRenderingContext2D | null = canvas.getContext("2d");
      if (context === null) throw new TypeError("시각 비교용 캔버스를 만들지 못했습니다.");
      context.drawImage(image, 0, 0);
      images.push(context.getImageData(0, 0, image.width, image.height));
    }
    if (images[0].width !== images[1].width || images[0].height !== images[1].height) throw new RangeError("기존 화면의 크기가 달라졌습니다.");
    let changedPixels: number = 0;
    let differingPixels: number = 0;
    let maxChannelDifference: number = 0;
    // 같은 시스템 글꼴의 미세한 래스터 차이만 허용하고 위치·색상 변화는 검출합니다.
    const channelTolerance: number = 3;
    for (let index: number = 0; index < images[0].data.length; index += 4) {
      let delta: number = 0;
      for (let channel: number = 0; channel < 4; channel++) delta = Math.max(delta, Math.abs(images[0].data[index + channel] - images[1].data[index + channel]));
      if (delta > 0) changedPixels++;
      if (delta > channelTolerance) differingPixels++;
      maxChannelDifference = Math.max(maxChannelDifference, delta);
    }
    return { width: images[0].width, height: images[0].height, changedPixels, differingPixels, maxChannelDifference, channelTolerance };
  }, { before, after });
  expect(result.differingPixels, "기존 화면 시각 차이: " + name).toBe(0);
  return { name, ...result };
}

type Contrast = Readonly<{ foreground: string; background: string; minimum: number; actual: number; }>;
function luminance(hex: string): number {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new TypeError("대비 계산에는 6자리 색상이 필요합니다: " + hex);
  const values: readonly number[] = [1, 3, 5].map((offset): number => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255).map((value): number => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
}
function contrast(foreground: string, background: string, minimum: number): Contrast {
  const colors: ReadonlyMap<string, string> = new Map([...tokens.matchAll(/--alter-([a-z-]+): (#[0-9a-f]{6});/g)].map((match): readonly [string, string] => [match[1], match[2]]));
  const fg: string | undefined = colors.get(foreground);
  const bg: string | undefined = colors.get(background);
  if (fg === undefined || bg === undefined) throw new TypeError("대비 검사 토큰이 없습니다: " + foreground + "/" + background);
  const a: number = luminance(fg);
  const b: number = luminance(bg);
  const actual: number = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  expect(actual, foreground + "/" + background).toBeGreaterThanOrEqual(minimum);
  return { foreground, background, minimum, actual };
}
const contrasts: readonly Contrast[] = [contrast("ink", "canvas", 4.5), contrast("ink-secondary", "canvas", 4.5), contrast("on-primary", "primary", 4.5), contrast("success", "success-surface", 4.5), contrast("warning", "warning-surface", 4.5), contrast("danger", "danger-surface", 4.5), contrast("disabled-ink", "disabled-surface", 4.5), contrast("border-control", "surface", 3), contrast("focus", "canvas", 3)];

await mkdir("outputs/ui-foundation", { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page: Page = await browser.newPage({ viewport: { width: 402, height: 874 }, locale: "ko-KR", reducedMotion: "reduce" });
  await page.route("**/*", async (route): Promise<void> => { throw new Error("스타일 검증 중 외부 요청이 발생했습니다: " + route.request().method() + " " + route.request().url()); });
  await page.setContent(markup);
  await page.addStyleTag({ content: legacy });
  const before: readonly StyleSnapshot[] = await legacySnapshot(page);
  const visualBefore: string[] = [];
  for (const id of ["public", "quarantine", "legacy"]) {
    const pixels: Buffer = await page.locator("#" + id).screenshot({ path: "outputs/ui-foundation/" + id + "-before.png" });
    visualBefore.push(createHash("sha256").update(pixels).digest("hex"));
  }
  await page.addStyleTag({ content: newStyles });
  expect(await legacySnapshot(page)).toEqual(before);
  const visualAfter: string[] = [];
  for (const id of ["public", "quarantine", "legacy"]) {
    const pixels: Buffer = await page.locator("#" + id).screenshot({ path: "outputs/ui-foundation/" + id + "-after.png" });
    visualAfter.push(createHash("sha256").update(pixels).digest("hex"));
  }
  const legacyVisualComparison: PixelComparison[] = [];
  for (const name of ["public", "quarantine", "legacy"]) legacyVisualComparison.push(await comparePixels(page, name));
  await expect(page.locator("#control")).toHaveCSS("font-size", "16px");
  await expect(page.locator("#control")).toHaveCSS("min-height", "48px");
  await expect(page.locator("#control")).toHaveCSS("border-radius", "12px");
  await expect(page.locator("#control")).toHaveCSS("color", "rgb(23, 36, 30)");
  await expect(page.locator("#portal-control")).toHaveCSS("border-radius", "12px");
  await expect(page.locator("#portal-control")).toHaveCSS("color", "rgb(23, 36, 30)");
  await expect(page.locator("#hidden")).toHaveCSS("display", "none");
  await page.locator("#inert-button").evaluate((element: HTMLButtonElement): void => element.focus());
  await expect(page.locator("#inert-button")).not.toBeFocused();
  await page.locator("#control").focus();
  await expect(page.locator("#control")).toHaveCSS("outline-color", "rgb(28, 100, 73)");
  await expect(page.locator("#control")).toHaveCSS("outline-width", "3px");
  await expect(page.locator("#disabled")).toHaveCSS("opacity", "1");
  // 나중에 도착한 기존 페이지 CSS와의 로딩 순서에도 의존하지 않습니다.
  await page.addStyleTag({ content: legacy });
  await expect(page.locator("#control")).toHaveCSS("border-radius", "12px");
  await expect(page.locator("#control")).toHaveCSS("outline-color", "rgb(28, 100, 73)");
  await expect(page.locator("#hidden")).toHaveCSS("display", "none");
  expect(await legacySnapshot(page)).toEqual(before);
  await expect(page.locator("#plain-link svg")).toHaveCSS("width", "20px");
  await expect(page.locator("#plain-link svg")).toHaveCSS("stroke-width", "1.8px");
  await expect(page.locator("#selected-link svg")).toHaveCSS("stroke-width", "2.15px");
  await expect(page.locator("#selected-link svg")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator("#selected-link")).toHaveAccessibleName("학습");
  await expect(page.locator("#selected-link")).toHaveCSS("background-color", "rgb(232, 239, 230)");
  await page.locator("#selected-link").focus();
  await expect(page.locator("#selected-link")).toHaveCSS("outline-color", "rgb(28, 100, 73)");
  const typography: Array<Readonly<{ width: number; scale: number }>> = [];
  for (const width of [320, 390, 402, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 874 });
    for (const scale of [100, 200]) {
      await page.evaluate((percent: number): void => { document.documentElement.style.fontSize = percent + "%"; }, scale);
      await expect(page.locator("#control")).toHaveCSS("font-size", scale === 100 ? "16px" : "32px");
      const fits: boolean = await page.locator("#mixed [data-alter-ui]").evaluate((element): boolean => element.scrollWidth <= element.clientWidth);
      expect(fits, "새 범위 가로 넘침: " + width + "/" + scale).toBe(true);
      await expect(page.locator("#long-heading")).toHaveCSS("overflow-wrap", "anywhere");
      await expect(page.locator("#math")).toHaveCSS("white-space", "pre");
      await expect(page.locator("#number")).toHaveCSS("font-variant-numeric", "lining-nums tabular-nums");
      await page.locator("#mixed").screenshot({ path: "outputs/ui-foundation/typography-" + width + "-" + scale + ".png" });
      typography.push({ width, scale });
    }
  }
  await page.evaluate((): void => { document.documentElement.style.fontSize = "100%"; });
  await page.setViewportSize({ width: 402, height: 874 });
  expect(await page.pageErrors()).toEqual([]);
  await mkdir("outputs/ui-foundation", { recursive: true });
  await page.screenshot({ path: "outputs/ui-foundation/mixed-402.png", fullPage: true });
  const report = { status: "passed", scope: "synthetic mixed CSS fixture; not app/device acceptance", sourceSha256: createHash("sha256").update(newStyles).digest("hex"), legacyStylesPreserved: before.length, legacyVisualComparison, visualBefore, visualAfter, portalTokens: true, hiddenAndInert: true, reversedStylesheetOrder: true, contrasts, typography, iconLabelAndSelection: true, browser: browser.version(), paidCalls: 0, externalWrites: 0 };
  await writeFile("outputs/ui-foundation/report.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
} finally { await browser.close(); }
