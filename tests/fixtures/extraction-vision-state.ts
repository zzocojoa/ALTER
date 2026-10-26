import { fixturePricing } from "./ai-pricing";
import { fixtureFunding } from "./ai-funding";
import { checkAiFunding } from "../../db/repositories/ai-funding";
import { getExtractionPage, saveExtractionCorrection } from "../../db/repositories/extraction-pages";
import { confirmExtractionSegments } from "../../db/repositories/extraction-confirmations";
import { correctedPage } from "../../lib/extraction/confirmation";
import { dispatchPageVision, recoverPageVision } from "../../lib/extraction/vision-service";
import { preparePageVisionRequest, visionContext } from "../../lib/extraction/vision";
import type { VerifiedExtractionPage } from "../../lib/extraction/server";
import type { StoredExtractionPage } from "../../lib/extraction/state";
import type { PreparedPageImage } from "../../lib/extraction/image";
import type { AiRunRuntime } from "../../lib/ai/run";
import type { AiConfiguration } from "../../lib/ai/configuration";
import type { PageVision } from "../../lib/extraction/vision-contract";

/** 실제 D1 페이지 상태와 합성 공급자 응답을 연결해 중복 생성 없는 복구를 검사합니다. */
export async function checkVisionState(db: D1Database, proof: VerifiedExtractionPage, page: StoredExtractionPage): Promise<readonly string[]> {
  const now: number = Date.now(); const base = fixturePricing();
  const provenance = { ...base.pricing.provenance, evidence: "verified" as const, source: "https://example.invalid/mock-only", checkedAt: now - 1, validFrom: now - 1, validUntil: now + 3600000 };
  const pricing = { ...base, pricing: { ...base.pricing, provenance }, exchange: { ...base.exchange, provenance }, tax: { ...base.tax, provenance }, fee: { ...base.fee, provenance } };
  const configuration: AiConfiguration = { pricing, funding: fixtureFunding(proof.owner.userId, pricing.id, now), support: [] };
  const image: PreparedPageImage = { dataUrl: "data:image/png;base64,AQ==", mime: "image/png", bytes: 1, sha256: "b".repeat(64), width: 100, height: 100, sourceWidth: 100, sourceHeight: 100, rotation: 0, sourceToImage: [1, 0, 0, 1, 0, 0], coordinateSpace: "pdf-viewport" };
  const prepared = await preparePageVisionRequest(proof, image, page.id);
  const output: PageVision = { kind: "page-vision", binding: prepared.binding, page: { filePage: proof.filePage, method: "vision", status: "complete", width: 100, height: 100, rotation: 0, segments: [{ id: "s0", kind: "formula", text: "a² + b² = c²", bounds: null, transform: null, uncertain: true, reason: "합성 시험" }], error: null, requiresConfirmation: true } };
  let generationRequests: number = 0;
  const generationStarted = Promise.withResolvers<void>();
  const releaseGeneration = Promise.withResolvers<void>();
  const runtime: AiRunRuntime = { db, authenticate: async () => proof.owner, readApiKey: (): string => "fixture-only-not-a-key", now: (): number => now, loadContext: async () => visionContext(prepared.binding), requireSupport: async (): Promise<void> => {}, authorizeSources: async (_owner, request): Promise<void> => { if (request.requestFingerprint !== prepared.fingerprint) throw new Error("합성 입력이 바뀌었어요."); }, wait: async (): Promise<void> => {}, warn: (): void => {}, checkFunding: (owner, bound, time) => checkAiFunding(db, owner, bound, configuration.funding, time), fetch: async (input, init): Promise<Response> => {
    const request: Request = new Request(input, init);
    if (request.url.endsWith("/input_tokens")) return Response.json({ input_tokens: 1000 }, { headers: { "x-request-id": "req_count" } });
    generationRequests += 1;
    generationStarted.resolve();
    await releaseGeneration.promise;
    return Response.json({ id: "resp_page_state_fixture", model: "gpt-6-luna", object: "response", created_at: 1, status: "completed", max_output_tokens: 4096, output: [{ type: "message", id: "msg_fixture", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify({ result: output }), annotations: [] }] }], usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0, cache_write_tokens_details: { ttl_30m_tokens: 0, ttl_12h_tokens: 0 } }, output_tokens: 200, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 1200 } }, { headers: { "x-request-id": "req_vision" } });
  } };
  await db.prepare("CREATE TRIGGER fixture_stop_after_ai BEFORE INSERT ON extraction_results WHEN json_extract(NEW.result,'$.method')='vision' BEGIN SELECT RAISE(ABORT,'fixture_save_interruption'); END").run();
  const firstDispatch = dispatchPageVision(runtime, configuration, proof, page, image, { owner: proof.owner, expectedVersion: page.version, requestKey: crypto.randomUUID() }, new AbortController().signal).then((): boolean => false, (error: unknown): boolean => { if (!(error instanceof Error)) throw error; return true; });
  await generationStarted.promise;
  try {
    const running = await getExtractionPage(db, proof.owner, page.id);
    const duplicate = await dispatchPageVision(runtime, configuration, proof, running, image, { owner: proof.owner, expectedVersion: page.version, requestKey: crypto.randomUUID() }, new AbortController().signal);
    if (duplicate.page.state !== "running" || duplicate.page.version !== running.version || duplicate.attempts.length !== 1 || generationRequests !== 1) throw new Error("처리 중 같은 이미지의 중복 요청이 기존 상태를 반환하지 않았어요.");
    let mismatchRejected: boolean = false;
    try { await dispatchPageVision(runtime, configuration, proof, running, { ...image, sha256: "c".repeat(64) }, { owner: proof.owner, expectedVersion: running.version, requestKey: crypto.randomUUID() }, new AbortController().signal); }
    catch (error: unknown) { if (!(error instanceof Error) || !("code" in error) || error.code !== "reference_conflict") throw error; mismatchRejected = true; }
    if (!mismatchRejected || generationRequests !== 1) throw new Error("처리 중 다른 이미지 요청을 차단하지 못했어요.");
  } finally { releaseGeneration.resolve(); await firstDispatch; }
  const interrupted: boolean = await firstDispatch;
  await db.prepare("DROP TRIGGER fixture_stop_after_ai").run();
  const unknown = await getExtractionPage(db, proof.owner, page.id);
  if (!interrupted || unknown.state !== "unknown" || generationRequests !== 1 || unknown.pendingImage === null || unknown.resultVersion !== page.resultVersion) throw new Error("생성 후 저장 실패 상태가 보존되지 않았어요.");
  const duplicateUnknown = await dispatchPageVision(runtime, configuration, proof, unknown, image, { owner: proof.owner, expectedVersion: unknown.version, requestKey: crypto.randomUUID() }, new AbortController().signal);
  if (duplicateUnknown.page.state !== "unknown" || duplicateUnknown.page.pendingAiKey !== unknown.pendingAiKey || generationRequests !== 1) throw new Error("결과 미확정 요청을 재생성하거나 완료로 바꿨어요.");
  const recovered = await recoverPageVision(runtime, proof, unknown, new AbortController().signal);
  if (recovered.page.state !== "complete" || recovered.page.result?.method !== "vision" || recovered.page.confirmedSegmentIds.length !== 0 || recovered.page.resultImage?.sha256 !== image.sha256 || generationRequests !== 1) throw new Error("재생성 없이 기존 응답을 복구하지 못했어요.");
  await recoverPageVision(runtime, proof, recovered.page, new AbortController().signal);
  if (generationRequests !== 1) throw new Error("중복 복구가 생성으로 바뀌었어요.");
  const repeated = await dispatchPageVision(runtime, configuration, proof, recovered.page, image, { owner: proof.owner, expectedVersion: recovered.page.version, requestKey: crypto.randomUUID() }, new AbortController().signal);
  if (generationRequests !== 1 || JSON.stringify(repeated.page) !== JSON.stringify(recovered.page)) throw new Error("완료 이미지 중복 입력이 새 생성 또는 결과 버전을 만들었어요.");
  const correction = correctedPage(repeated.page, { selectionRevision: proof.job.revision, filePage: proof.filePage, expectedVersion: repeated.page.version, resultId: repeated.page.resultId!, segments: [{ id: "s0", text: "원본과 대조한 수정 수식" }] });
  await saveExtractionCorrection(db, { owner: proof.owner, expectedVersion: repeated.page.version, requestKey: crypto.randomUUID() }, proof, repeated.page, correction);
  const corrected = await getExtractionPage(db, proof.owner, page.id);
  await confirmExtractionSegments(db, { owner: proof.owner, expectedVersion: corrected.version, requestKey: crypto.randomUUID() }, proof, corrected, { selectionRevision: proof.job.revision, filePage: proof.filePage, expectedVersion: corrected.version, resultId: corrected.resultId!, segmentIds: ["s0"], printedPage: "iii", comparedWithOriginal: true });
  const confirmed = await getExtractionPage(db, proof.owner, page.id);
  const retained = await dispatchPageVision(runtime, configuration, proof, confirmed, image, { owner: proof.owner, expectedVersion: confirmed.version, requestKey: crypto.randomUUID() }, new AbortController().signal);
  if (generationRequests !== 1 || JSON.stringify(retained.page) !== JSON.stringify(confirmed)) throw new Error("같은 이미지 재입력이 수정본 또는 확인 상태를 덮어썼어요.");
  const noResponse: StoredExtractionPage = { ...unknown, pendingAiKey: "fixture-no-response-id" };
  const uncertain = await recoverPageVision(runtime, proof, noResponse, new AbortController().signal);
  if (uncertain.page.state !== "unknown" || generationRequests !== 1) throw new Error("응답 ID 없는 상태가 생성으로 바뀌었어요.");
  return ["in-flight-same-image-returns-running-without-generation", "in-flight-different-image-rejected", "unknown-same-image-keeps-unknown-without-generation", "ai-success-before-page-save-failure-keeps-unknown", "saved-ai-result-recovers-once-without-regeneration", "no-response-id-or-lease-expiry-never-replays", "same-completed-image-does-not-generate-or-version", "same-image-retains-manual-correction-and-confirmation"];
}
