import { requireCoffeePage } from "../ai/coffee-probe.ts";
import { requireApprovedPageVision, runApprovedPageVision } from "./approved-vision.ts";
import { contentHash, domainFailure } from "../domain/contracts.ts";
import type { Command } from "../domain/contracts.ts";
import type { AiConfiguration } from "../ai/configuration.ts";
import type { AiRunRuntime } from "../ai/run.ts";
import { recoverAiResponse } from "../ai/recover.ts";
import { readAiRequestStatus } from "../../db/repositories/ai-status.ts";
import type { AiRequestState } from "../../db/repositories/ai-status.ts";
import { beginVisionExtraction, completeVisionExtraction, getExtractionPage, recordVisionFailure, requireExtractionPageBinding } from "../../db/repositories/extraction-pages.ts";
import type { VerifiedExtractionPage } from "./server.ts";
import type { PreparedPageImage } from "./image.ts";
import { metadataOfImage } from "./state.ts";
import type { StoredExtractionPage } from "./state.ts";
import { pageVisionBinding, preparePageVisionRequest, runPageVision, runPageVisionAcceptance } from "./vision.ts";
import { validatePageVision } from "./vision-contract.ts";
import { extractionAcceptanceHash, extractionAcceptancePage } from "./acceptance-fixture.ts";

export type VisionProgress = Readonly<{ page: StoredExtractionPage; attempts: readonly AiRequestState[] }>;
function commandFor(page: StoredExtractionPage, proof: VerifiedExtractionPage): Command { return { owner: proof.owner, expectedVersion: page.version, requestKey: crypto.randomUUID() }; }

/** 저장된 응답 ID만 조회하며 미확정 상태나 리스 만료를 새 생성으로 바꾸지 않습니다. */
export async function recoverPageVision(runtime: AiRunRuntime, proof: VerifiedExtractionPage, page: StoredExtractionPage, signal: AbortSignal): Promise<VisionProgress> {
  requireExtractionPageBinding(page, proof, commandFor(page, proof));
  if (page.pendingAiKey === null || page.pendingImage === null) return { page, attempts: [] };
  const attempts: readonly AiRequestState[] = await readAiRequestStatus(runtime.db, proof.owner, page.pendingAiKey);
  const latest: AiRequestState | undefined = attempts.at(-1);
  if (latest?.stage === "invalid" && (page.state === "running" || page.state === "unknown")) {
    await recordVisionFailure(runtime.db, commandFor(page, proof), proof, page, "failed", latest.failureCode ?? "ai_response_invalid");
    return { page: await getExtractionPage(runtime.db, proof.owner, page.id), attempts };
  }
  if (latest === undefined || latest.responseId === null) return { page, attempts };
  const output = await recoverAiResponse(runtime, latest.callId, "page-vision", signal);
  if (output.result.kind !== "page-vision") throw domainFailure("reference_conflict", "extraction.vision.kind", null);
  validatePageVision(output.result, pageVisionBinding(proof, page.pendingImage));
  await completeVisionExtraction(runtime.db, commandFor(page, proof), proof, page, output.result.page, page.pendingImage, latest.callId);
  return { page: await getExtractionPage(runtime.db, proof.owner, page.id), attempts: await readAiRequestStatus(runtime.db, proof.owner, page.pendingAiKey) };
}

/** 실행 의도를 먼저 저장하고 같은 호출 안의 재시도만 공통 원장에 예약합니다. */
export async function dispatchPageVision(runtime: AiRunRuntime, configuration: AiConfiguration, proof: VerifiedExtractionPage, page: StoredExtractionPage, image: PreparedPageImage, command: Command, signal: AbortSignal): Promise<VisionProgress> {
  requireExtractionPageBinding(page, proof, command);
  // 진행 중인 동일 입력은 기존 상태만 반환하고 새 생성이나 자동 복구를 시작하지 않습니다.
  if (page.state === "running" || page.state === "unknown") {
    if (page.pendingAiKey === null || page.pendingImage === null) throw domainFailure("result_unknown", "extraction.vision.pending-binding-missing", null);
    if (await contentHash(page.pendingImage) !== await contentHash(metadataOfImage(image))) throw domainFailure("reference_conflict", "extraction.vision.pending-image-changed", null);
    return { page, attempts: await readAiRequestStatus(runtime.db, proof.owner, page.pendingAiKey) };
  }
  // 같은 이미지의 완료 결과는 수정본과 확인 상태까지 그대로 보존합니다.
  if (page.state === "complete" && page.result !== null && page.resultImage !== null && await contentHash(page.resultImage) === await contentHash(metadataOfImage(image))) return { page, attempts: [] };
  const prepared = await preparePageVisionRequest(proof, image, page.id);
  const approval = configuration.pageVisionProbeApproval?.materialId === proof.job.selection.materialId ? configuration.pageVisionProbeApproval : undefined;
  if (approval) await requireApprovedPageVision(approval, prepared, runtime.now());
  const coffee = configuration.coffeeProbeApproval;
  if (coffee) requireCoffeePage(coffee, prepared.binding, runtime.now());
  const acceptance: boolean = configuration.pricing.purpose === "prepaid-probe";
  if (acceptance && !approval && !coffee && (proof.job.selection.originalHash !== extractionAcceptanceHash || proof.filePage !== extractionAcceptancePage)) throw domainFailure("reference_conflict", "extraction.vision.fixed-acceptance-only", null);
  const logicalKey: string = coffee ? `coffee-vision:${coffee.id}:${prepared.binding.materialId}:${prepared.binding.filePage}:${image.sha256}` : approval ? `page-vision-approved:${approval.requestFingerprint}` : acceptance ? `page-vision-acceptance:${await contentHash({ original: extractionAcceptanceHash, page: proof.filePage })}` : `page-vision:${page.id}:${page.version}:${image.sha256}`;
  await beginVisionExtraction(runtime.db, command, proof, page, logicalKey, metadataOfImage(image));
  const running = await getExtractionPage(runtime.db, proof.owner, page.id);
  try {
    const outcome = coffee ? await runPageVision(runtime, prepared, logicalKey, configuration.pricing, signal) : approval ? await runApprovedPageVision(runtime, prepared, logicalKey, configuration.pricing, approval, signal) : acceptance ? await runPageVisionAcceptance(runtime, prepared, logicalKey, configuration.pricing, extractionAcceptanceHash, signal) : await runPageVision(runtime, prepared, logicalKey, configuration.pricing, signal);
    if (outcome.kind === "existing") return await recoverPageVision(runtime, proof, running, signal);
    if (outcome.output.result.kind !== "page-vision") throw domainFailure("reference_conflict", "extraction.vision.kind", null);
    await completeVisionExtraction(runtime.db, commandFor(running, proof), proof, running, outcome.output.result.page, metadataOfImage(image), outcome.callId);
    return { page: await getExtractionPage(runtime.db, proof.owner, page.id), attempts: await readAiRequestStatus(runtime.db, proof.owner, logicalKey) };
  } catch (error: unknown) {
    const attempts = await readAiRequestStatus(runtime.db, proof.owner, logicalKey);
    const latest: AiRequestState | undefined = attempts.at(-1);
    const current = await getExtractionPage(runtime.db, proof.owner, page.id);
    if (current.state === "running") {
      const reason: string = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "page-vision-result-unresolved";
      await recordVisionFailure(runtime.db, commandFor(current, proof), proof, current, latest === undefined || latest.stage === "invalid" ? "failed" : "unknown", reason);
    }
    throw error;
  }
}
