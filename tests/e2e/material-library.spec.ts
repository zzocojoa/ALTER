import { checkAccessibility } from "../fixtures/accessibility";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { pngImage } from "../fixtures/png-bytes";
import { pageTreePdf, readablePdf, scannedPdf } from "../fixtures/pdf-bytes";

async function registerFile(page: Page, title: string, name: string, mimeType: string, buffer: Uint8Array): Promise<void> {
  await page.getByRole("combobox", { name: "입력 방식", exact: true }).selectOption("file");
  await page.getByLabel("자료 제목", { exact: true }).fill(title);
  await page.getByLabel("원본 파일").setInputFiles({ name, mimeType, buffer: Buffer.from(buffer) });
  await page.getByRole("button", { name: "자료 등록하기", exact: true }).click();
  await expect(page.getByText("자료를 등록했어요. 목록에서 원본을 열어 보세요.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: new RegExp(title) }).click();
}

test("자료 등록과 PDF·사진·텍스트 원본을 키보드·모바일에서 확인한다", async ({ page }, info): Promise<void> => {
  await page.goto("/signin-with-chatgpt?return_to=/learn/materials");
  await expect(page.getByRole("heading", { name: "자료 보관함", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "저장 공간 확인", exact: true }).click();
  await expect(page.getByText("실제 저장 공간과 쓰기·읽기를 확인했어요. 자료를 등록할 수 있어요.", { exact: true })).toBeVisible();
  const courseForm = page.locator("details").filter({ has: page.getByText("새 과정 이름 만들기", { exact: true }) });
  if (await courseForm.getAttribute("open") === null) await page.getByText("새 과정 이름 만들기", { exact: true }).click();
  const extractionPosts: { filePage: number; result: { filePage: number; segments: { text: string }[] } }[] = [];
  page.on("request", (request): void => { if (request.method() === "POST" && /\/extraction\/pages\/[^/]+\/text$/.test(new URL(request.url()).pathname)) extractionPosts.push(request.postDataJSON()); });
  const suffix: string = `${info.project.name}-${Date.now()}`;
  await page.getByLabel("과정 이름", { exact: true }).fill(`검증 과정 ${suffix}`);
  await page.getByRole("button", { name: "과정 만들기", exact: true }).click();
  await expect(page.getByText("과정을 만들었어요. 이 과정에 자료를 등록할 수 있어요.", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "과정", exact: true }).selectOption({ label: `검증 과정 ${suffix}` });
  await page.getByLabel("자료 제목", { exact: true }).fill(`문자 원본 ${suffix}`);
  await page.getByRole("combobox", { name: "입력 방식", exact: true }).selectOption("text");
  const literal: string = "<script>window.ALTER_UNSAFE=1</script>\n" + "학습 원본을 그대로 확인합니다.\n".repeat(150);
  await page.getByLabel("텍스트 원본", { exact: true }).fill(literal);
  await page.getByRole("button", { name: "자료 등록하기", exact: true }).click();
  await expect(page.getByText("자료를 등록했어요. 목록에서 원본을 열어 보세요.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: new RegExp(`문자 원본 ${suffix}`) }).click();
  await expect(page.getByLabel("텍스트 원본", { exact: true }).last()).toContainText("<script>window.ALTER_UNSAFE=1</script>");
  expect(await page.evaluate((): boolean => "ALTER_UNSAFE" in window)).toBe(false);
  await registerFile(page, `PDF 원본 ${suffix}`, "multi.pdf", "application/pdf", readablePdf(3));
  await expect(page.getByText("1페이지를 열었어요.", { exact: true })).toBeVisible();
  await page.getByText("이 페이지의 텍스트", { exact: true }).click();
  await expect(page.locator("pre.material-text")).toContainText("ALTER page 1");
  await page.getByRole("button", { name: "다음 페이지", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("2페이지를 열었어요.", { exact: true })).toBeVisible();
  await page.getByLabel("파일 페이지", { exact: true }).fill("3");
  await expect(page.getByText("3페이지를 열었어요.", { exact: true })).toBeVisible();
  await page.getByLabel("목차 파일 페이지", { exact: true }).fill("1");
  await page.getByLabel("학습할 파일 페이지", { exact: true }).fill("3, 3");
  await page.getByRole("button", { name: "선택 범위 확인", exact: true }).click();
  await expect(page.getByText("선택한 파일 페이지: 1 (목차), 3 (본문)", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "파일 3페이지 이미지 준비", exact: true }).click();
  await expect(page.getByRole("img", { name: "파일 3페이지 판독 이미지", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "파일 2페이지 이미지 준비", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "선택 페이지 텍스트 추출", exact: true }).click();
  await expect(page.getByLabel("파일 1페이지 추출 결과", { exact: true })).toContainText("ALTER page 1");
  await page.getByRole("button", { name: "파일 3페이지 결과", exact: true }).click();
  await expect(page.getByLabel("파일 3페이지 추출 결과", { exact: true })).toContainText("ALTER page 3");
  await expect(page.getByLabel("파일 2페이지 추출 결과", { exact: true })).toHaveCount(0);
  expect(extractionPosts.map((body): number => body.filePage)).toEqual([1, 3]);
  expect(JSON.stringify(extractionPosts)).not.toContain("ALTER page 2");
  await page.reload();
  await page.getByRole("button", { name: new RegExp(`PDF 원본 ${suffix}`) }).click();
  await expect(page.getByLabel("파일 1페이지 추출 결과", { exact: true })).toContainText("ALTER page 1");
  await page.getByRole("button", { name: "파일 3페이지 결과", exact: true }).click();
  await expect(page.getByLabel("파일 3페이지 추출 결과", { exact: true })).toContainText("ALTER page 3");
  const result = page.getByLabel("파일 3페이지 추출 결과", { exact: true });
  await result.getByLabel("인쇄된 쪽수", { exact: true }).fill("iii");
  await result.getByRole("button", { name: "쪽수 저장", exact: true }).click();
  await expect(result.getByLabel("인쇄된 쪽수", { exact: true })).toHaveValue("iii");
  await result.getByLabel("구간 1 확인", { exact: true }).check();
  await result.getByLabel("선택한 구간을 이 파일 페이지의 원본과 대조했어요.", { exact: true }).check();
  await result.getByRole("button", { name: "선택 구간 확인 저장", exact: true }).click();
  await expect(result.getByText("텍스트 · 확인됨", { exact: true })).toBeVisible();
  await result.getByRole("button", { name: "확인 구간 출처 연결", exact: true }).click();
  await expect(result).toContainText("학습 근거로 연결됨 · 파일 3페이지 · 인쇄 쪽수 iii");
  if (info.project.name === "mobile-chromium") {
    await page.getByRole("button", { name: "원본 보기", exact: true }).click();
    await expect(page.getByLabel("대조 원본 3페이지", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "추출 결과 보기", exact: true }).click();
  }
  await page.screenshot({ path: `outputs/extraction-confirmed-${info.project.name}.png`, fullPage: true });
  await result.getByText("추출 내용 수정", { exact: true }).click();
  await result.getByRole("textbox", { name: "구간 1 수정", exact: true }).fill("ALTER page 3 corrected");
  await result.getByRole("button", { name: "수정본 저장", exact: true }).click();
  await expect(result).toContainText("ALTER page 3 corrected");
  await expect(result.getByText("텍스트 · 미확인", { exact: true })).toBeVisible();
  await expect(result.getByText("텍스트 · 확인됨", { exact: true })).toHaveCount(0);
  await page.getByLabel("학습할 파일 페이지", { exact: true }).fill("4");
  await expect(page.getByText("선택한 파일 페이지: 1 (목차), 3 (본문)", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "선택 범위 확인", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("원본 페이지 수");
  const image: Buffer = await readFile("tests/fixtures/jpeg/gray.jpg");
  await registerFile(page, `스캔 원본 ${suffix}`, "scan.pdf", "application/pdf", scannedPdf(image, "/DCTDecode", 17, 19));
  await expect(page.getByText("1페이지를 열었어요.", { exact: true })).toBeVisible();
  await page.getByLabel("학습할 파일 페이지", { exact: true }).fill("1");
  await page.getByRole("button", { name: "선택 범위 확인", exact: true }).click();
  await page.getByRole("button", { name: "선택 페이지 텍스트 추출", exact: true }).click();
  await expect(page.getByText("추출된 텍스트가 없어요. 원본을 확인한 뒤 비전 판독이나 직접 전사를 선택해 주세요.", { exact: true })).toBeVisible();
  await registerFile(page, `빈 PDF ${suffix}`, "blank.pdf", "application/pdf", pageTreePdf(1, 1));
  await page.getByLabel("학습할 파일 페이지", { exact: true }).fill("1");
  await page.getByRole("button", { name: "선택 범위 확인", exact: true }).click();
  await page.getByRole("button", { name: "선택 페이지 텍스트 추출", exact: true }).click();
  await expect(page.getByText("빈 페이지예요.", { exact: true })).toBeVisible();
  await registerFile(page, `사진 원본 ${suffix}`, "photo.jpg", "image/jpeg", image);
  await expect(page.getByRole("img", { name: `사진 원본 ${suffix}` })).toBeVisible();
  await page.getByLabel("사진 확대", { exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("125%", { exact: true })).toBeVisible();
  await page.getByRole("region", { name: "사진 이동 영역" }).focus();
  await page.keyboard.press("ArrowRight");
  const png: Buffer = await readFile("tests/fixtures/pngsuite/basn2c08.png");
  await registerFile(page, `PNG 원본 ${suffix}`, "source.png", "image/png", png);
  await expect(page.getByRole("img", { name: `PNG 원본 ${suffix}` })).toBeVisible();
  const photoExpand = page.getByRole("button", {name:"사진 원본 크게 보기",exact:true}); await photoExpand.click();
  const photoDialog = page.getByRole("dialog",{name:"사진 원본",exact:true}); await expect(photoDialog.getByRole("img")).toBeVisible();
  await photoDialog.getByLabel("사진 확대",{exact:true}).focus(); await page.keyboard.press("ArrowRight"); await expect(photoDialog.getByText("125%",{exact:true})).toBeVisible();
  await checkAccessibility(page,".original-dialog[open]",info);
  await photoDialog.getByRole("button",{name:"확대 화면 닫기",exact:true}).click(); await expect(photoExpand).toBeFocused();
  const landscape: Buffer = await readFile("tests/fixtures/jpeg/testorig.jpg");
  await registerFile(page, `가로 사진 ${suffix}`, "landscape.jpg", "image/jpeg", landscape);
  await expect(page.getByRole("img", { name: `가로 사진 ${suffix}` })).toBeVisible();
  const rows: Buffer = Buffer.alloc((3000 * 4 + 1) * 4000);
  const transparent: Buffer = pngImage({ width: 3000, height: 4000, depth: 8, color: 6, interlace: 0 }, rows);
  await registerFile(page, `투명 고해상도 사진 ${suffix}`, "transparent.png", "image/png", transparent);
  await page.getByLabel("학습할 파일 페이지", { exact: true }).fill("1");
  await page.getByRole("button", { name: "선택 범위 확인", exact: true }).click();
  await page.getByRole("combobox", { name: "판독 이미지 회전", exact: true }).selectOption("90");
  await page.getByRole("button", { name: "파일 1페이지 이미지 준비", exact: true }).click();
  const preparedImage = page.getByRole("img", { name: "파일 1페이지 판독 이미지", exact: true });
  await expect(preparedImage).toBeVisible();
  expect(await preparedImage.evaluate((element: HTMLImageElement): readonly number[] => [element.naturalWidth, element.naturalHeight])).toEqual([1847, 1385]);
  await page.screenshot({ path: `outputs/extraction-photo-${info.project.name}.png`, fullPage: true });
  await page.screenshot({ path: `outputs/material-library-${info.project.name}.png`, fullPage: true });
  expect(await page.pageErrors()).toEqual([]);
  expect(await page.evaluate((): boolean => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

for (const failure of [{ status: 401, message: "로그인이 만료됐어요" }, { status: 404, message: "확정된 자료를 찾을 수 없어요" }, { status: 416, message: "요청한 원본 범위를 읽을 수 없어요" }, { status: 403, message: "이 자료에 접근할 권한이 없어요" }]) {
  test(`서버 오류 ${failure.status} 안내를 표시한다 (응답 주입)`, async ({ page }): Promise<void> => {
    await page.goto("/signin-with-chatgpt?return_to=/learn/materials");
    await page.route("**/api/materials/*/file", async (route): Promise<void> => { await route.fulfill({ status: failure.status, contentType: "application/json", body: JSON.stringify({ error: "injected-ui-test" }) }); });
    await page.getByRole("button", { name: /PDF 원본/ }).first().click();
    await expect(page.getByRole("alert").filter({ hasText: failure.message }).first()).toBeVisible();
    await expect(page.locator("canvas")).toHaveCount(0);
  });
}

for (const fault of ["missing-worker", "mismatched-worker", "corrupt-pdf", "encrypted-pdf"] as const) {
  test(`PDF 로더 실패를 종료하고 안내한다: ${fault} (응답 주입)`, async ({ page }): Promise<void> => {
    await page.goto("/signin-with-chatgpt?return_to=/learn/materials");
    if (fault === "missing-worker") await page.route("**/pdfjs-6.4.299/pdf.worker.min.mjs", async (route): Promise<void> => { await route.fulfill({ status: 404, body: "not found" }); });
    if (fault === "mismatched-worker") {
      const worker: string = (await readFile("public/pdfjs-6.4.299/pdf.worker.min.mjs", "utf8")).replaceAll("6.4.299", "0.0.0");
      await page.route("**/pdfjs-6.4.299/pdf.worker.min.mjs", async (route): Promise<void> => { await route.fulfill({ contentType: "text/javascript", body: worker }); });
    }
    if (fault === "corrupt-pdf" || fault === "encrypted-pdf") await page.route("**/api/materials/*/file", async (route): Promise<void> => {
      const body: Buffer = fault === "encrypted-pdf" ? await readFile("tests/fixtures/pdf/encrypted-40-bit-R3.pdf") : Buffer.from("%PDF-1.7\ncorrupt\n");
      await route.fulfill({ status: 200, headers: { "content-type": "application/pdf", "content-length": String(body.length), etag: '"injected"' }, body: route.request().method() === "HEAD" ? undefined : body });
    });
    await page.getByRole("button", { name: /PDF 원본/ }).first().click();
    await expect(page.getByRole("alert").filter({ hasText: fault === "missing-worker" ? "PDF 작업 파일" : fault === "mismatched-worker" ? "does not match" : fault === "encrypted-pdf" ? "암호" : "손상" }).first()).toBeVisible();
    await expect(page.locator("canvas")).toHaveCount(0);
  });
}
