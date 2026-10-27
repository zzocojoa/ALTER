import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { MaterialLibrary } from "../../lib/materials/library";
import { materialBrowser, emptyMaterialLibrary, materialFixture } from "../fixtures/materials-scenario";

const transferId: string = "00000000-0000-4000-a000-000000000020";
const source: Buffer = Buffer.from("한글 원본", "utf8");
const sourceHash: string = createHash("sha256").update(source).digest("hex");
const card = materialFixture(21);
const metadata = { ...card.metadata, title: "복구 시험", filename: "복구.txt", sha256: sourceHash, bytes: source.length };

test("응답 유실은 미확정으로 남기고 같은 파일·요청·판으로만 복구한다", async ({ page }) => {
  let library: MaterialLibrary = emptyMaterialLibrary;
  let bodyCalls: number = 0;
  const writes: string[] = [];
  await materialBrowser(page, library, async (route): Promise<void> => {
    const request = route.request(); const path: string = new URL(request.url()).pathname;
    if (request.method() !== "GET") writes.push(request.method() + " " + path);
    if (path === "/api/materials") { await route.fulfill({ json: library }); return; }
    if (path === "/api/materials/uploads") {
      library = { ...library, pending: [{ id: transferId, materialId: card.id, version: 1, state: "reserved", metadata }], usage: { occupiedBytes: 0, reservedBytes: source.length, untrackedBytes: 0, activeTransfers: 1, blocked: true } };
      await route.fulfill({ json: { id: transferId, materialId: card.id, version: 1, state: "reserved" } }); return;
    }
    if (path.endsWith("/body")) {
      bodyCalls += 1;
      if (bodyCalls === 1) { library = { ...library, pending: [{ ...library.pending[0], version: 2, state: "unknown" }] }; await route.abort("failed"); return; }
      expect(path).toBe(`/api/materials/uploads/${transferId}/body`); expect(request.headers()["x-upload-version"]).toBe("3"); expect(request.postDataBuffer()).toEqual(source);
      await route.fulfill({ json: { id: transferId, materialId: card.id, version: 4, state: "stored" } }); return;
    }
    if (path.endsWith("/recover")) {
      expect(request.postDataJSON()).toEqual({ expectedVersion: 2 });
      await route.fulfill({ json: { id: transferId, materialId: card.id, version: 3, state: "reserved", nextAction: "upload" } }); return;
    }
    if (path.endsWith("/complete")) {
      expect(request.postDataJSON()).toEqual({ expectedVersion: 4 });
      library = { ...emptyMaterialLibrary, materials: [{ ...card, metadata, file: { ...card.file, bytes: source.length, sha256: sourceHash } }] };
      await route.fulfill({ json: { id: transferId, materialId: card.id, version: 5, state: "registered", pages: 1 } }); return;
    }
    if (path.endsWith("/extraction")) { await route.fulfill({ json: { job: null, pages: [] } }); return; }
    if (path.endsWith("/file")) { await route.fulfill({ contentType: "text/plain", body: source }); return; }
    throw new Error("승인하지 않은 검사 요청: " + request.method() + " " + path);
  });
  await page.getByLabel("자료 제목", { exact: true }).fill(metadata.title);
  await page.getByLabel("원본 파일", { exact: true }).setInputFiles({ name: metadata.filename, mimeType: metadata.mime, buffer: source });
  await page.getByRole("button", { name: "자료 등록하기", exact: true }).click();
  await expect(page.locator("[data-upload-issue=unknown]")).toBeVisible();
  const pending = page.getByRole("region", { name: "중단된 자료", exact: true });
  await expect(pending).toContainText("저장 결과 미확정");
  await expect(page.getByRole("button", { name: "자료 등록하기", exact: true })).toBeDisabled();
  await page.getByLabel("원본 파일", { exact: true }).setInputFiles({ name: metadata.filename, mimeType: metadata.mime, buffer: Buffer.from("다른 원본") });
  await page.getByRole("button", { name: "상태 확인·이어서 등록", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "처음 등록한 것과 같은 파일" })).toBeVisible();
  expect(bodyCalls).toBe(1);
  await expect(pending).toBeVisible();
  await page.getByLabel("원본 파일", { exact: true }).setInputFiles({ name: metadata.filename, mimeType: metadata.mime, buffer: source });
  await page.getByRole("button", { name: "상태 확인·이어서 등록", exact: true }).click();
  await expect(page.locator(".alter-upload-progress")).toHaveAttribute("data-phase", "confirmed");
  await expect(pending).toHaveCount(0);
  await expect(page.locator(".alter-material-row")).toHaveCount(1);
  expect(writes.filter((value): boolean => value === "POST /api/materials/uploads")).toHaveLength(1);
  expect(writes.some((value): boolean => /cleanup|vision|google/.test(value))).toBe(false);
  expect(await page.pageErrors()).toEqual([]);
});

for (const sample of [{ status: 507, code: "material_storage_unavailable", field: "application-capacity", kind: "capacity" }, { status: 409, code: "request_key_reused", field: "request_key", kind: "conflict" }, { status: 503, code: "result_unknown", field: "storage", kind: "unknown" }]) {
  test(`등록 ${sample.status} 실패에서 원본 입력을 유지하고 자동 재시도하지 않는다`, async ({ page }) => {
    const writes: string[] = [];
    await materialBrowser(page, emptyMaterialLibrary, async (route): Promise<void> => {
      const request = route.request(); const path: string = new URL(request.url()).pathname;
      if (path === "/api/materials") { await route.fulfill({ json: emptyMaterialLibrary }); return; }
      expect(path).toBe("/api/materials/uploads"); writes.push(request.method() + " " + path);
      await route.fulfill({ status: sample.status, json: { error: sample.code, field: sample.field } });
    });
    await page.getByLabel("자료 제목", { exact: true }).fill(metadata.title);
    await page.getByLabel("원본 파일", { exact: true }).setInputFiles({ name: metadata.filename, mimeType: metadata.mime, buffer: source });
    await page.getByRole("button", { name: "자료 등록하기", exact: true }).click();
    await expect(page.locator(`[data-upload-issue=${sample.kind}]`)).toBeVisible();
    await expect(page.locator(".alter-upload-progress")).toHaveAttribute("data-phase", "attention");
    await expect(page.getByLabel("자료 제목", { exact: true })).toHaveValue(metadata.title);
    expect(await page.getByLabel("원본 파일", { exact: true }).evaluate((element: HTMLInputElement): string | null => element.files?.[0]?.name ?? null)).toBe(metadata.filename);
    expect(writes).toEqual(["POST /api/materials/uploads"]);
  });
}

test("임시 정리 실패와 목록 조회 실패는 원본·예약을 완료나 빈 상태로 바꾸지 않는다", async ({ page }) => {
  let failRead: boolean = false;
  const library: MaterialLibrary = { ...emptyMaterialLibrary, materials: [materialFixture(40)], pending: [{ id: transferId, materialId: card.id, version: 2, state: "unknown", metadata }], usage: { occupiedBytes: 12, reservedBytes: source.length, untrackedBytes: 0, activeTransfers: 1, blocked: true } };
  await materialBrowser(page, library, async (route): Promise<void> => {
    const path: string = new URL(route.request().url()).pathname;
    if (path === "/api/materials") { await route.fulfill(failRead ? { status: 503, json: { error: "storage_failure" } } : { json: library }); return; }
    expect(path).toBe(`/api/materials/uploads/${transferId}/cleanup`);
    await route.fulfill({ status: 503, json: { error: "result_unknown" } });
  });
  const pending = page.getByRole("region", { name: "중단된 자료", exact: true });
  await pending.getByText("이 임시 자료를 그만 등록하려면", { exact: true }).click();
  await page.getByRole("button", { name: "이 임시 자료 정리", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("503");
  await expect(pending).toBeVisible();
  await expect(page.locator(".material-summary")).toContainText("예약 / 256 MiB");
  failRead = true;
  await page.getByRole("button", { name: "목록 새로 확인", exact: true }).click();
  await expect(page.getByRole("heading", { name: "목록을 새로 확인하지 못했어요", exact: true })).toBeVisible();
  await expect(page.locator(".alter-material-row")).toBeDisabled();
  await expect(page.getByText("배울 내용을 한곳에", { exact: true })).toHaveCount(0);
  await expect(pending).toBeVisible();
});

test("사용자 전송 중단은 서버 정리로 간주하지 않고 예약을 유지한다", async ({ page }) => {
  let library: MaterialLibrary = emptyMaterialLibrary;
  let release: (() => void) | null = null;
  const held: Promise<void> = new Promise((resolve): void => { release = resolve; });
  const writes: string[] = [];
  await materialBrowser(page, library, async (route): Promise<void> => {
    const path: string = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET") writes.push(path);
    if (path === "/api/materials") { await route.fulfill({ json: library }); return; }
    if (path === "/api/materials/uploads") { await route.fulfill({ json: { id: transferId, materialId: card.id, version: 1, state: "reserved" } }); return; }
    expect(path).toBe(`/api/materials/uploads/${transferId}/body`);
    library = { ...library, pending: [{ id: transferId, materialId: card.id, version: 2, state: "unknown", metadata }], usage: { occupiedBytes: 0, reservedBytes: source.length, untrackedBytes: 0, activeTransfers: 1, blocked: true } };
    await held;
    await route.fulfill({ json: { id: transferId, materialId: card.id, version: 3, state: "stored" } });
  });
  await page.getByLabel("자료 제목", { exact: true }).fill(metadata.title);
  await page.getByLabel("원본 파일", { exact: true }).setInputFiles({ name: metadata.filename, mimeType: metadata.mime, buffer: source });
  await page.getByRole("button", { name: "자료 등록하기", exact: true }).click();
  await expect(page.locator(".alter-upload-progress")).toHaveAttribute("data-phase", "transferring");
  await page.getByRole("button", { name: "전송 중단", exact: true }).click();
  await expect(page.locator("[data-upload-issue=interrupted]")).toBeVisible();
  await expect(page.getByRole("region", { name: "중단된 자료", exact: true })).toContainText("저장 결과 미확정");
  await expect(page.locator(".alter-material-row")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "자료 등록하기", exact: true })).toBeDisabled();
  if (release === null) throw new Error("전송 응답 제어가 없습니다.");
  (release as () => void)();
  expect(writes).toEqual(["/api/materials/uploads", `/api/materials/uploads/${transferId}/body`]);
});
