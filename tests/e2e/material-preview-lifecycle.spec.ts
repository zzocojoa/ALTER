import { createHash, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { MaterialCard, MaterialLibrary } from "../../lib/materials/library";
import { readablePdf } from "../fixtures/pdf-bytes";

type ResourceProbe = Readonly<{ live: Set<Worker>; created: () => number; terminated: () => number }>;
type ProbeWindow = Window & typeof globalThis & { originalProbe: ResourceProbe };

test("늦은 원본 응답을 버리고 페이지 이동·반복 열기에서 Worker를 회수한다", async ({ page }, info): Promise<void> => {
  const pdf: Uint8Array = readablePdf(3); const courseId: string = randomUUID(); const id: string = randomUUID();
  const sha256: string = createHash("sha256").update(pdf).digest("hex");
  const material: MaterialCard = { id, courseId, metadata: { title: "원본 수명 검증", edition: "", role: "textbook", kind: "pdf", filename: "lifecycle.pdf", mime: "application/pdf", bytes: pdf.length, sha256 }, file: { materialId: id, kind: "pdf", role: "textbook", bytes: pdf.length, pages: 3, sha256, objectVersion: "lifecycle", sourceUrl: `/api/materials/${id}/file` } };
  const library: MaterialLibrary = { materials: [material], courses: [{ id: courseId, title: "원본 수명" }], pending: [], usage: null, hidden: false, hasMore: false, cursor: null };
  await page.addInitScript((): void => {
    const NativeWorker: typeof Worker = Worker; const live: Set<Worker> = new Set<Worker>(); let created: number = 0; let terminated: number = 0;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) { super(url, options); if (options?.name === "alter-selected-pdf") { live.add(this); created++; } }
      terminate(): void { if (live.delete(this)) terminated++; super.terminate(); }
    };
    (window as ProbeWindow).originalProbe = { live, created: (): number => created, terminated: (): number => terminated };
  });
  let hold: boolean = false; let release: (() => void) | null = null;
  let held: boolean = false;
  const methods: string[] = [];
  await page.goto("/signin-with-chatgpt?return_to=/learn/materials");
  await page.route("**/api/materials", async (route): Promise<void> => { methods.push(route.request().method()); await route.fulfill({ json: library }); });
  await page.route("**/api/materials/*/extraction", async (route): Promise<void> => { methods.push(route.request().method()); await route.fulfill({ json: { job: null, pages: [] } }); });
  await page.route("**/api/materials/*/file", async (route): Promise<void> => {
    methods.push(route.request().method());
    if (hold && route.request().method() === "HEAD") { hold = false; held = true; await new Promise<void>((resolve): void => { release = resolve; }); }
    await route.fulfill({ headers: { "content-type": "application/pdf", etag: '"lifecycle"', "content-length": String(pdf.length) }, body: route.request().method() === "HEAD" ? undefined : Buffer.from(pdf) });
  });
  const workers = async (): Promise<number> => page.evaluate((): number => (window as ProbeWindow).originalProbe.live.size);
  await page.getByRole("button", { name: "목록 새로 확인", exact: true }).click();
  for (let iteration: number = 0; iteration < 5; iteration++) {
    await page.locator(`#material-${id}`).click();
    const preview = page.getByRole("region", { name: "선택한 자료", exact: true });
    await expect(preview.getByText("1페이지를 열었어요.", { exact: true })).toBeVisible();
    await expect.poll(workers).toBe(1);
    if (iteration === 0) {
      await preview.getByLabel("파일 페이지", { exact: true }).fill("01");
      await expect(preview.getByText("1페이지를 열었어요.", { exact: true })).toBeVisible();
      hold = true;
      await preview.getByRole("button", { name: "다음 페이지", exact: true }).click();
      await expect.poll((): boolean => held).toBe(true);
      await preview.getByRole("button", { name: "다음 페이지", exact: true }).click();
      await expect(preview.getByText("3페이지를 열었어요.", { exact: true })).toBeVisible();
      if (release === null) throw new Error("지연 원본 응답을 찾지 못했습니다."); (release as () => void)();
      await preview.getByText("이 페이지의 텍스트", { exact: true }).click();
      await expect(preview.locator(".material-text")).toHaveText("ALTER page 3 ");
      await expect(preview.getByLabel("파일 페이지", { exact: true })).toHaveValue("3");
    }
    const current: string = iteration === 0 ? "3" : "1";
    await preview.getByRole("button", { name: `파일 ${current}페이지 원본 크게 보기`, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("region", { name: "대조 원본 이동 영역" })).toBeVisible();
    await expect.poll(workers).toBe(2);
    await page.keyboard.press("Escape");
    await expect.poll(workers).toBe(1);
    await preview.getByRole("button", { name: "자료 목록으로", exact: true }).click();
    await expect.poll(workers).toBe(0); await expect(page.locator("canvas")).toHaveCount(0);
  }
  const proof = await page.evaluate(() => { const probe: ResourceProbe = (window as ProbeWindow).originalProbe; return { created: probe.created(), terminated: probe.terminated(), live: probe.live.size }; });
  expect(proof.created).toBe(10); expect(proof.terminated).toBe(10); expect(proof.live).toBe(0);
  await info.attach("원본 자원 정리", { body: JSON.stringify({ ...proof, cycles: 5, actualDevice: false, actualHeapMeasurement: false }), contentType: "application/json" });
  expect(methods.every((method): boolean => method === "GET" || method === "HEAD")).toBe(true);
  expect(await page.pageErrors()).toEqual([]);
});
