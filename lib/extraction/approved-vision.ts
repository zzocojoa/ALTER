import { pageVisionProbeApproval } from "../ai/configuration.ts";
import type { PageVisionProbeApproval } from "../ai/configuration.ts";
import { executeAiAttempt } from "../ai/attempt.ts";
import { requireDispatchPricing } from "../ai/pricing.ts";
import type { PricingVersion } from "../ai/pricing.ts";
import { prepareAiRequest } from "../ai/request-bound.ts";
import type { PreparedAiRequest } from "../ai/request-bound.ts";
import { runAiAttemptSequence } from "../ai/run.ts";
import type { AiRunOutcome, AiRunRuntime } from "../ai/run.ts";
import { domainFailure } from "../domain/contracts.ts";
import { hashFile } from "../learning-upload.ts";
import type { PageVisionRequest } from "./vision.ts";

/** 실제 첨부에 한정된 서버 승인을 원본·전송 이미지·전체 요청과 대조합니다. */
export async function requireApprovedPageVision(approval: PageVisionProbeApproval, prepared: PageVisionRequest, now: number): Promise<PreparedAiRequest> {
  const verified: PageVisionProbeApproval = pageVisionProbeApproval.parse(approval);
  const binding = prepared.binding;
  if (verified.approvedAt > now || verified.validUntil <= now || binding.materialId !== verified.materialId || binding.originalHash !== verified.originalHash || binding.filePage !== verified.filePage || binding.imageSha256 !== verified.imageSha256 || prepared.fingerprint !== verified.requestFingerprint) throw domainFailure("reference_conflict", "extraction.approved-image-scope", null);
  const request: PreparedAiRequest = await prepareAiRequest(prepared.request);
  if (request.requestFingerprint !== verified.requestFingerprint || request.imageCount !== 1 || prepared.request.responseContract !== "page-vision") throw domainFailure("reference_conflict", "extraction.approved-image-request", null);
  for (const message of prepared.request.messages) for (const part of message.content) {
    if (part.type !== "input_image") continue;
    const bytes: Uint8Array<ArrayBuffer> = Uint8Array.from(atob(part.dataUrl.slice(part.dataUrl.indexOf(",") + 1)), (character: string): number => character.charCodeAt(0));
    if (await hashFile(bytes.buffer) !== verified.imageSha256 || bytes.length !== part.bytes || part.width !== binding.width || part.height !== binding.height) throw domainFailure("reference_conflict", "extraction.approved-image-bytes", null);
  }
  return request;
}

/** 승인된 한 장도 기존 원장·소유자·출처 검사를 유지하며 재시도 전에 승인을 다시 검사합니다. */
export async function runApprovedPageVision(runtime: AiRunRuntime, prepared: PageVisionRequest, logicalKey: string, pricing: PricingVersion, approval: PageVisionProbeApproval, signal: AbortSignal): Promise<AiRunOutcome> {
  if (pricing.purpose !== "prepaid-probe" || logicalKey !== `page-vision-approved:${approval.requestFingerprint}`) throw domainFailure("reference_conflict", "extraction.approved-image-dispatch", null);
  requireDispatchPricing(pricing, runtime.now());
  const request: PreparedAiRequest = await requireApprovedPageVision(approval, prepared, runtime.now());
  const owner = await runtime.authenticate();
  await runtime.requireSupport(owner, request, runtime.now());
  return runAiAttemptSequence({ ...runtime, authorizeSources: async (identity, actual): Promise<void> => {
    await requireApprovedPageVision(approval, { ...prepared, request: actual.request, fingerprint: actual.requestFingerprint }, runtime.now());
    await runtime.authorizeSources(identity, actual);
  } }, { logicalRequestKey: logicalKey, request: prepared.request, pricing, expectedKind: "page-vision" }, executeAiAttempt, signal);
}
