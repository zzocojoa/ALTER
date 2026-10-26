import { env } from "cloudflare:workers";
import { ownerAiRuntime, waitForRetry } from "../ai/server";
import type { AiConfiguration } from "../ai/configuration";
import { requireAiSupport } from "../ai/support";
import type { AiRunRuntime } from "../ai/run";
import { domainFailure } from "../domain/contracts";
import { authorizePageVision, requireExtractionPage } from "./server";
import type { VerifiedExtractionPage } from "./server";
import { getExtractionPage } from "../../db/repositories/extraction-pages";
import type { StoredExtractionPage } from "./state";
import type { PreparedPageImage } from "./image";
import { pageVisionBinding, preparePageVisionRequest, visionContext } from "./vision";

/** 판독 완료 시에도 서버 원본·선택·입력 해시가 같은지 다시 조회합니다. */
export async function pageVisionRuntime(configuration: AiConfiguration, proof: VerifiedExtractionPage, page: StoredExtractionPage, image: PreparedPageImage, signal: AbortSignal): Promise<AiRunRuntime> {
  const prepared = await preparePageVisionRequest(proof, image, page.id);
  return { ...ownerAiRuntime(configuration), authorizeSources: (owner, request) => authorizePageVision(env.DB, env.BUCKET, owner, proof.owner, proof, image, request, prepared, signal),
    loadContext: async (owner) => {
      if (owner.userId !== proof.owner.userId) throw domainFailure("reference_conflict", "extraction.vision.owner", null);
      const current = await requireExtractionPage(env.DB, env.BUCKET, owner, proof.job.jobId, proof.job.revision, proof.filePage);
      const stored = await getExtractionPage(env.DB, owner, page.id);
      if (!stored.pendingImage || stored.pendingImage.sha256 !== image.sha256) throw domainFailure("reference_conflict", "extraction.vision.input-changed", null);
      return visionContext(pageVisionBinding(current, stored.pendingImage));
    },
    wait: waitForRetry, warn: (warning): void => console.warn(warning), requireSupport: async (owner, _request, now): Promise<void> => {
      if (owner.userId !== configuration.funding.ownerId) throw domainFailure("reference_conflict", "extraction.vision.funding-owner", null);
      requireAiSupport(configuration.support, ["text", "image", "structured-output", "usage", "output-limit"], configuration.funding.accountFingerprint, now);
    },
  };
}

export function pageRecoveryRuntime(configuration: AiConfiguration, proof: VerifiedExtractionPage, page: StoredExtractionPage): AiRunRuntime {
  return { ...ownerAiRuntime(configuration), authorizeSources: async (): Promise<void> => { throw new Error("복구 경로는 새 입력 전송을 허용하지 않습니다."); }, requireSupport: async (): Promise<void> => { throw new Error("복구 경로는 새 생성을 허용하지 않습니다."); }, wait: waitForRetry, warn: (warning): void => console.warn(warning), loadContext: async (owner) => {
    const current = await requireExtractionPage(env.DB, env.BUCKET, owner, proof.job.jobId, proof.job.revision, proof.filePage);
    const stored = await getExtractionPage(env.DB, owner, page.id);
    if (stored.pendingImage === null || stored.pendingAiKey !== page.pendingAiKey) throw domainFailure("reference_conflict", "extraction.vision.recovery-input", null);
    return visionContext(pageVisionBinding(current, stored.pendingImage));
  } };
}
