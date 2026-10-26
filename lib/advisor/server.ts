import { env } from "cloudflare:workers";
import { z } from "zod";
import { getAdvisor, listAdvisors } from "../../db/repositories/advisor";
import { isDomainFailure } from "../../db/repositories/atomic";
import type { AdvisorState } from "./contracts";
import { advisorContext, advisorRequest } from "./ai";
import { requireAiConfiguration } from "../ai/configuration";
import type { AiConfiguration } from "../ai/configuration";
import { ownerAiRuntime, waitForRetry } from "../ai/server";
import { requireAiSupport } from "../ai/support";
import type { AiRunRuntime } from "../ai/run";
import { prepareAiRequest } from "../ai/request-bound";
import { domainFailure, seoulStudyDate } from "../domain/contracts";
import type { SiteIdentity } from "../domain/contracts";
import { privateJson } from "../owner-access";
import { materialErrorResponse } from "../materials/server-access";

export function advisorConfiguration(): AiConfiguration { return requireAiConfiguration(env.ALTER_AI_CONFIGURATION); }
export async function advisorRuntime(configuration: AiConfiguration, state: AdvisorState): Promise<AiRunRuntime> {
  const prepared = await prepareAiRequest(advisorRequest(state));
  return { ...ownerAiRuntime(configuration), wait: waitForRetry, warn: (warning): void => console.warn(warning),
    authorizeSources: async (owner, request): Promise<void> => {
      const current: AdvisorState = await getAdvisor(env.DB, owner, state.id);
      if (current.version !== state.version || request.requestFingerprint !== prepared.requestFingerprint || request.imageCount !== 0) throw domainFailure("version_conflict", "advisor.ai.input-changed", null);
    },
    loadContext: async (owner) => {
      const current: AdvisorState = await getAdvisor(env.DB, owner, state.id);
      if (current.pending?.key !== state.pending?.key) throw domainFailure("version_conflict", "advisor.ai.context-changed", null);
      return advisorContext(current);
    },
    requireSupport: async (owner, _request, now): Promise<void> => {
      if (owner.userId !== configuration.funding.ownerId) throw domainFailure("reference_conflict", "advisor.ai.funding-owner", null);
      requireAiSupport(configuration.support, ["text", "structured-output", "usage", "output-limit"], configuration.funding.accountFingerprint, now);
    },
  };
}
export function advisorErrorResponse(error: unknown): Response {
  if (error instanceof z.ZodError) return privateJson({ error: "advisor_input_invalid", message: error.issues[0].message, field: error.issues[0].path.join(".") }, 400);
  if (isDomainFailure(error)) return privateJson({ error: error.code, operation: error.operation, message: error.code === "version_conflict" ? "다른 화면에서 변경됐어요. 최신 기록을 불러와 확인해 주세요." : error.code === "limit_exceeded" ? "시간 또는 비용 한도를 초과했어요. 계획과 예산을 확인해 주세요." : "처리를 확정하지 못했어요. 기존 답변은 보존되며 결과 조회만 다시 할 수 있어요." }, 409);
  if (error instanceof Error && "code" in error && typeof error.code === "string" && error.code.startsWith("ai_")) return privateJson({ error: error.code, message: "AI 검증·가격·잔액 조건을 충족하지 못했어요. 기존 답변을 유지합니다. 시험 승인과 운영 비용 설정을 확인해 주세요." }, 503);
  return materialErrorResponse(error);
}

export async function readAdvisorPage(owner: SiteIdentity): Promise<Readonly<{ initial: readonly AdvisorState[]; today: string }>> { return { initial: await listAdvisors(env.DB, owner), today: seoulStudyDate(Date.now()) }; }
