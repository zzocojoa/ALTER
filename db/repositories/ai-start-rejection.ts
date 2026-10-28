import { domainFailure } from "../../lib/domain/contracts.ts";
import type { Command } from "../../lib/domain/contracts.ts";
import { aiStartRejection } from "../../lib/tutor/ai-start-rejection.ts";
import type { AiStartAction } from "../../lib/tutor/ai-start-rejection.ts";
import { isDomainFailure, readAtomicReceipt } from "./atomic.ts";

/** 시작 전 검증 또는 원자적 롤백의 명시적 거부와 영수증 부재를 함께 확인합니다. 저장 결과 불명은 해제하지 않습니다. */
export async function rejectAiStart(db: D1Database, cmd: Command, id: string, action: AiStartAction, error: unknown): Promise<never> {
  if (!isDomainFailure(error) || !["validation", "version_conflict", "reference_conflict", "limit_exceeded"].includes(error.code)) throw error;
  const scope: string = action === "feedback" || action === "review" ? `tutor.editor-${action}` : `tutor.${action}`;
  const receipt = await readAtomicReceipt(db, cmd, scope, { id }, id);
  // 같은 키의 이전·동시 요청이 시작된 경우에는 원래 오류와 복구 잠금을 유지합니다.
  if (receipt !== null) throw error;
  const rejection = aiStartRejection.parse({ status: "not-started", key: cmd.requestKey, id, expectedVersion: cmd.expectedVersion, action });
  throw Object.assign(domainFailure(error.code, error.operation, error), { aiStartRejection: rejection });
}
