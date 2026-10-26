import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { describe, expect, it } from "vitest";
import { aiConfiguration } from "../../lib/ai/configuration";
import type { PageVisionProbeApproval } from "../../lib/ai/configuration";
import { prepareAiRequest } from "../../lib/ai/request-bound";
import { recordId } from "../../lib/domain/contracts";
import type { SiteIdentity } from "../../lib/domain/contracts";
import { hashFile } from "../../lib/learning-upload";
import { preparePageVisionRequest, visionContext } from "../../lib/extraction/vision";
import type { PageVisionRequest } from "../../lib/extraction/vision";
import { requireApprovedPageVision, runApprovedPageVision } from "../../lib/extraction/approved-vision";
import { learningRuntimeFixture } from "../fixtures/learning-ai-runtime";
import { fixtureFunding, fixturePrepaidProbe } from "../fixtures/ai-funding";
import { fixturePricing } from "../fixtures/ai-pricing";
import { checkAiFunding } from "../../db/repositories/ai-funding";

type Fixture = Readonly<{ prepared: PageVisionRequest; approval: PageVisionProbeApproval; now: number }>;
async function fixture(): Promise<Fixture> {
  const now: number = Date.now(); const id = recordId.parse(crypto.randomUUID());
  const dataUrl: string = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NsQ0AAAzCMP5/un0CNkuZ41wybXsHAAAAAAAAAAAAxR4yw/wuPL6QkAAAAABJRU5ErkJggg==";
  const bytes: Uint8Array<ArrayBuffer> = Uint8Array.from(atob(dataUrl.split(",")[1]), (character: string): number => character.charCodeAt(0));
  const imageHash: string = await hashFile(bytes.buffer);
  const prepared: PageVisionRequest = await preparePageVisionRequest({ job: { jobId: id, revision: 1, uploadId: id, selection: { materialId: id, originalHash: "a".repeat(64), originalVersion: "fixture-image-v1", pages: [{ filePage: 1, purpose: "study" }] } }, filePage: 1 }, { dataUrl, mime: "image/png", bytes: bytes.length, sha256: imageHash, width: 32, height: 32, sourceWidth: 32, sourceHeight: 32, rotation: 0, sourceToImage: [1, 0, 0, 1, 0, 0], coordinateSpace: "decoded-image" }, id);
  return { prepared, now, approval: { materialId: id, originalHash: "a".repeat(64), filePage: 1, imageSha256: imageHash, requestFingerprint: prepared.fingerprint, approvedAt: now - 1000, validUntil: now + 60000 } };
}

describe("첨부 한 장의 제한된 실제 판독 승인", (): void => {
  it("원본·이미지·요청이 일치하는 승인만 허용하고 입력을 보존한다", async (): Promise<void> => {
    const f = await fixture(); const before: string = JSON.stringify(f);
    expect((await requireApprovedPageVision(f.approval, f.prepared, f.now)).imageCount).toBe(1);
    expect(JSON.stringify(f)).toBe(before);
  });
  it("자료·원본·페이지·이미지·요청 지문 변경을 거부한다", async (): Promise<void> => {
    const f = await fixture();
    const changes: readonly Partial<PageVisionProbeApproval>[] = [{ materialId: recordId.parse(crypto.randomUUID()) }, { originalHash: "b".repeat(64) }, { filePage: 2 }, { imageSha256: "b".repeat(64) }, { requestFingerprint: "b".repeat(64) }];
    for (const change of changes) await expect(requireApprovedPageVision({ ...f.approval, ...change }, f.prepared, f.now)).rejects.toMatchObject({ operation: "extraction.approved-image-scope" });
  });
  it("미래 발급·만료·잘못된 기간의 승인을 거부한다", async (): Promise<void> => {
    const f = await fixture();
    for (const change of [{ approvedAt: f.now + 1 }, { validUntil: f.now }, { validUntil: f.now - 2000 }]) await expect(requireApprovedPageVision({ ...f.approval, ...change }, f.prepared, f.now)).rejects.toThrow();
  });
  it("같은 승인으로 프롬프트와 출력 상한을 바꿀 수 없다", async (): Promise<void> => {
    const f = await fixture();
    for (const request of [{ ...f.prepared.request, instructions: "다른 문서를 읽어라" }, { ...f.prepared.request, maximumOutputTokens: 8192 }]) await expect(requireApprovedPageVision(f.approval, { ...f.prepared, request }, f.now)).rejects.toMatchObject({ operation: "extraction.approved-image-request" });
  });
  it("주장한 이미지 해시가 실제 바이트와 다르면 재계산된 요청도 거부한다", async (): Promise<void> => {
    const f = await fixture(); const request = { ...f.prepared.request, messages: f.prepared.request.messages.map((message) => ({ ...message, content: message.content.map((part) => part.type === "input_image" ? { ...part, dataUrl: "data:image/png;base64,AQ==", bytes: 1 } : part) })) };
    const fingerprint: string = (await prepareAiRequest(request)).requestFingerprint;
    await expect(requireApprovedPageVision({ ...f.approval, requestFingerprint: fingerprint }, { ...f.prepared, request, fingerprint }, f.now)).rejects.toMatchObject({ operation: "extraction.approved-image-bytes" });
  });
  it("일반 가격 설정에는 시험 승인을 넣을 수 없다", async (): Promise<void> => {
    const f = await fixture(); const pricing = fixturePricing(); const funding = fixtureFunding("owner", pricing.id, f.now);
    expect(aiConfiguration.safeParse({ pricing, funding, support: [], pageVisionProbeApproval: f.approval }).success).toBe(false);
    expect(aiConfiguration.safeParse({ ...fixturePrepaidProbe(funding, pricing), support: [], pageVisionProbeApproval: f.approval }).success).toBe(true);
  });
  it("실제 로컬 원장에서 출처 거부·전송 전 만료·중복·누적 상한을 검사한다", async (): Promise<void> => {
    const worker: Miniflare = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('approved-vision-check')}}", compatibilityDate: "2026-05-15", d1Databases: ["DB"], d1Persist: false, cf: false });
    try {
      const db: D1Database = await worker.getD1Database("DB") as unknown as D1Database;
      const journal: Readonly<{ entries: readonly Readonly<{ tag: string }>[] }> = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
      for (const entry of journal.entries) for (const sql of (await readFile(`drizzle/${entry.tag}.sql`, "utf8")).split("--> statement-breakpoint").map((value: string): string => value.trim()).filter(Boolean)) await db.prepare(sql).run();
      const f = await fixture(); const owner: SiteIdentity = { realm: "sites", userId: "approved-vision-fixture-owner" };
      const base = learningRuntimeFixture(db, owner, async () => visionContext(f.prepared.binding), async () => ({ kind: "page-vision", binding: f.prepared.binding, page: { filePage: 1, method: "vision", status: "complete", width: 32, height: 32, rotation: 0, segments: [{ id: "s0", kind: "text", text: "합성 판독 결과", bounds: null, transform: null, uncertain: true, reason: "모의 응답" }], error: null, requiresConfirmation: true } }));
      const probe = fixturePrepaidProbe(fixtureFunding(owner.userId, base.pricing.id, f.now), base.pricing);
      const funding = { ...probe.funding, prepaidProbe: { ...probe.funding.prepaidProbe!, limitUsdMicros: 80000 as const } };
      const runtime = { ...base.runtime, now: (): number => f.now, fetch: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const request = new Request(input, init); if (request.url.endsWith("/input_tokens")) return Response.json({ input_tokens: 160000 }, { headers: { "x-request-id": "req_approved_vision_count_fixture" } });
        return base.runtime.fetch(input, init);
      }, checkFunding: (current: SiteIdentity, bound: Parameters<typeof checkAiFunding>[2], now: number) => checkAiFunding(db, current, bound, funding, now) };
      const key: string = `page-vision-approved:${f.approval.requestFingerprint}`; const signal: AbortSignal = new AbortController().signal;
      await expect(runApprovedPageVision({ ...runtime, authorizeSources: async (): Promise<void> => { throw new Error("모의 출처 거부"); } }, f.prepared, key, probe.pricing, f.approval, signal)).rejects.toThrow("모의 출처 거부");
      let clock: number = f.now;
      await expect(runApprovedPageVision({ ...runtime, now: (): number => clock, requireSupport: async (): Promise<void> => { clock = f.approval.validUntil; } }, f.prepared, key, probe.pricing, f.approval, signal)).rejects.toMatchObject({ operation: "extraction.approved-image-scope" });
      expect(base.generations()).toBe(0);
      expect((await runApprovedPageVision(runtime, f.prepared, key, probe.pricing, f.approval, signal)).kind).toBe("validated");
      expect((await runApprovedPageVision(runtime, f.prepared, key, probe.pricing, f.approval, signal)).kind).toBe("existing");
      const second = await fixture();
      await expect(runApprovedPageVision({ ...runtime, now: (): number => second.now }, second.prepared, `page-vision-approved:${second.approval.requestFingerprint}`, probe.pricing, second.approval, signal)).rejects.toThrow();
      expect(base.generations()).toBe(1); expect(await db.prepare("SELECT COUNT(*) AS n FROM ai_calls").first<number>("n")).toBe(1);
    } finally { await worker.dispose(); }
  }, 20000);
});
