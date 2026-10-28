import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { MaterialLibrary } from "../../lib/materials/library";
import { checkAccessibility } from "../fixtures/accessibility";

const courseId: string = "00000000-0000-4000-a000-000000000001";
const transferId: string = "00000000-0000-4000-a000-000000000030";
const materialId: string = "00000000-0000-4000-a000-000000000031";

test("전송 성공만으로 등록을 표시하지 않고 등록 응답까지 단계와 원본을 보존한다", async ({ page }, info) => {
  const script: string = await readFile(".sites-runtime/materials-browser/fixture.iife.js", "utf8");
  const css: string = await readFile(".sites-runtime/materials-browser/fixture.css", "utf8");
  let library: MaterialLibrary = { materials: [], courses: [{ id: courseId, title: "과정" }], pending: [], usage: { occupiedBytes: 0, reservedBytes: 0, untrackedBytes: 0, activeTransfers: 0, blocked: false }, hidden: false, hasMore: false, cursor: null };
  let releaseReservation: (() => void) | null = null;
  let releaseTransfer: (() => void) | null = null;
  let releaseConfirmation: (() => void) | null = null;
  const reservation: Promise<void> = new Promise((resolve): void => { releaseReservation = resolve; });
  const transfer: Promise<void> = new Promise((resolve): void => { releaseTransfer = resolve; });
  const confirmation: Promise<void> = new Promise((resolve): void => { releaseConfirmation = resolve; });
  const writes: string[] = [];
  const source: Buffer = Buffer.from("검증용 문장", "utf8");
  const sourceHash: string = createHash("sha256").update(source).digest("hex");
  await page.route("https://upload.local.test/**", async (route): Promise<void> => {
    const request = route.request(); const path: string = new URL(request.url()).pathname;
    if (path === "/fixture.js") { await route.fulfill({ contentType: "text/javascript", body: script }); return; }
    if (path === "/fixture.css") { await route.fulfill({ contentType: "text/css", body: css }); return; }
    if (request.method() !== "GET") writes.push(request.method() + " " + path);
    if (path === "/api/materials") { await route.fulfill({ json: library }); return; }
    if (path === "/api/materials/uploads") {
      expect(request.postDataJSON()).toMatchObject({ courseId, metadata: { title: "시험 자료", filename: "시험.txt", bytes: source.length, sha256: sourceHash } });
      expect(request.headers()["idempotency-key"]).toBeTruthy();
      await reservation;
      await route.fulfill({ json: { id: transferId, materialId, version: 1, state: "reserved" } }); return;
    }
    if (path.endsWith("/body")) {
      expect(request.postDataBuffer()).toEqual(source); expect(request.headers()["x-upload-version"]).toBe("1");
      await transfer;
      await route.fulfill({ json: { id: transferId, materialId, version: 2, state: "stored" } }); return;
    }
    if (path.endsWith("/complete")) {
      expect(request.postDataJSON()).toEqual({ expectedVersion: 2 });
      await confirmation;
      library = { ...library, materials: [{ id: materialId, courseId, metadata: { title: "시험 자료", filename: "시험.txt", edition: "", role: "textbook", kind: "text", mime: "text/plain", bytes: source.length, sha256: sourceHash }, file: { materialId, kind: "text", role: "textbook", bytes: source.length, pages: 1, sha256: sourceHash, objectVersion: "registered-fixture", sourceUrl: `/api/materials/${materialId}/file` } }] };
      await route.fulfill({ json: { id: transferId, materialId, version: 3, state: "registered", pages: 1 } }); return;
    }
    if (path.endsWith("/extraction")) { await route.fulfill({ json: { job: null, pages: [] } }); return; }
    if (path.endsWith("/file")) { await route.fulfill({ contentType: "text/plain", body: source }); return; }
    expect(path).toBe("/learn/materials");
    await route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="materials-fixture"></div><script id="initial-library" type="application/json">${JSON.stringify(library)}</script><script src="/fixture.js"></script></html>` });
  });
  await page.goto("https://upload.local.test/learn/materials");
  await page.getByLabel("자료 제목", { exact: true }).fill("시험 자료");
  await page.getByLabel("원본 파일", { exact: true }).setInputFiles({ name: "시험.txt", mimeType: "text/plain", buffer: source });
  await page.getByRole("button", { name: "자료 등록하기", exact: true }).click();
  const progress = page.getByRole("region", { name: "자료 등록 단계", exact: true });
  await expect(progress).toHaveAttribute("data-phase", "reserving");
  await expect(page.getByRole("button", { name: "자료 등록하기", exact: true })).toBeDisabled();
  if (releaseReservation === null) throw new Error("예약 응답 제어가 준비되지 않았습니다.");
  (releaseReservation as () => void)();
  await expect(progress).toHaveAttribute("data-phase", "transferring");
  await expect(page.getByRole("button", { name: "전송 중단", exact: true })).toBeEnabled();
  if (releaseTransfer === null) throw new Error("전송 응답 제어가 준비되지 않았습니다.");
  (releaseTransfer as () => void)();
  await expect(progress).toHaveAttribute("data-phase", "confirming");
  await expect(progress).not.toContainText("서버에서 원본 등록을 확인했어요");
  await expect(page.locator(".alter-material-row")).toHaveCount(0);
  if (releaseConfirmation === null) throw new Error("등록 응답 제어가 준비되지 않았습니다.");
  (releaseConfirmation as () => void)();
  // 원본을 자동으로 열면 등록 단계가 가려지므로 지속되는 완료 안내와 원본을 먼저 확인합니다.
  await expect(page.locator(".material-feedback").getByRole("status")).toHaveText("자료 등록을 확인했어요. 새 자료의 원본을 열어요.");
  const preview = page.getByRole("region", { name: "선택한 자료", exact: true });
  await expect(preview).toBeFocused();
  await expect(preview).toContainText("검증용 문장");
  await expect(page).toHaveURL(new RegExp(`open=${materialId}`));
  await page.getByRole("button", { name: "자료 목록으로", exact: true }).click();
  await expect(page.locator(`#material-${materialId}`)).toBeFocused();
  await expect(progress).toHaveAttribute("data-phase", "confirmed");
  await expect(page).not.toHaveURL(/open=/);
  await page.getByText("새 자료 등록", { exact: true }).click();
  await expect(page.getByLabel("자료 제목", { exact: true })).toHaveValue("시험 자료");
  await checkAccessibility(page, ".material-library", info);
  expect(writes).toEqual(["POST /api/materials/uploads", `PUT /api/materials/uploads/${transferId}/body`, `POST /api/materials/uploads/${transferId}/complete`]);
  expect(await page.pageErrors()).toEqual([]);
});
