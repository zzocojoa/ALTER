import { requireCurrentExecutionAuthority } from "../../db/repositories/restore-execution";
import { runAiSupportProbe } from "./support-probe";
import type { AiSupportProbeReport } from "./support-probe";
import { checkAiFunding } from "../../db/repositories/ai-funding";
import { requireAiConfiguration, requireConfiguredKey } from "./configuration";
import type { AiConfiguration } from "./configuration";
import { requireAiSupport } from "./support";
import { runAiRequest } from "./run";
import type { AiRunInput, AiRunOutcome } from "./run";
import type { CompletionRuntime } from "./complete";
import type { RetryWarning } from "./retry";
import { env } from "cloudflare:workers";
import { getOwnerDecision } from "../owner-access";
import { requireOpenAIKey } from "../runtime-settings";
import { hashFile } from "../learning-upload";
import { siteIdentity } from "../domain/contracts";
import type { SiteIdentity } from "../domain/contracts";
import { readStorage } from "../../db/repositories/atomic";
import type { PreparedAiRequest } from "./request-bound";
import type { AttemptRuntime } from "./attempt";

type SourceUpload = Readonly<{ expectedHash: string; verifiedHash: string | null; bytes: number; state: string }>;

/** Sites 인증 결과를 재사용하며 요청 본문의 신원이나 Google 계정으로 대체하지 않습니다. */
export async function authenticateAiOwner(): Promise<SiteIdentity> {
  const decision = await getOwnerDecision();
  if (decision.kind === "restore-quarantined") throw Object.assign(new Error("복원 검증이 끝날 때까지 AI 호출이 잠겨 있습니다."), { name: "AiAccessFailure", code: "restore_quarantined", status: 423 });
  if (decision.kind !== "owner") throw Object.assign(new Error("소유자 인증이 필요합니다."), { name: "AiAccessFailure", code: "ai_owner_required", status: decision.kind === "unauthenticated" ? 401 : decision.kind === "forbidden" ? 403 : 503 });
  const owner = siteIdentity.parse({ realm: "sites", userId: env.ALTER_OWNER_USER_ID });
  await requireCurrentExecutionAuthority(env.DB, owner);
  return owner;
}

/** 전송할 이미지 바이트를 소유자가 검증한 업로드와 대조합니다. */
export async function authorizeAiImages(db: D1Database, owner: SiteIdentity, prepared: PreparedAiRequest): Promise<void> {
  for (const message of prepared.request.messages) for (const part of message.content) {
    if (part.type !== "input_image") continue;
    const upload: SourceUpload | null = await readStorage("ai.source.authorize", () => db.prepare("SELECT u.expected_hash AS expectedHash,u.verified_hash AS verifiedHash,u.bytes,u.state FROM source_references s JOIN uploads u ON u.owner_id = s.owner_id AND u.id = s.upload_id AND u.material_id = s.material_id WHERE s.owner_id = ? AND s.id = ?").bind(owner.userId, part.sourceRefId).first<SourceUpload>());
    if (!upload || upload.state !== "verified" || upload.bytes !== part.bytes || upload.expectedHash !== upload.verifiedHash) throw Object.assign(new Error("선택한 이미지의 검증된 업로드가 필요합니다."), { name: "AiAccessFailure", code: "ai_source_denied", status: 403 });
    const binary: string = atob(part.dataUrl.slice(part.dataUrl.indexOf(",") + 1));
    const bytes: Uint8Array<ArrayBuffer> = Uint8Array.from(binary, (character: string): number => character.charCodeAt(0));
    if (await hashFile(bytes.buffer) !== upload.verifiedHash) throw Object.assign(new Error("선택한 이미지와 전송 내용이 다릅니다."), { name: "AiAccessFailure", code: "ai_source_denied", status: 403 });
  }
}

/** 자금 정책은 공통 호출 경로에 필수로 연결하며 키는 서버 바인딩에서만 읽습니다. */
export function ownerAiRuntime(configuration: AiConfiguration): AttemptRuntime {
  return { coffeeProbeApproval: configuration.coffeeProbeApproval, db: env.DB, authenticate: authenticateAiOwner, authorizeSources: (owner, request): Promise<void> => authorizeAiImages(env.DB, owner, request), checkFunding: (owner, bound, now) => checkAiFunding(env.DB, owner, bound, configuration.funding, now), readApiKey: (): string => requireOpenAIKey(env), now: Date.now, fetch: globalThis.fetch };
}

export async function waitForRetry(milliseconds: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject): void => {
    const abort = (): void => { clearTimeout(timer); reject(signal.reason); };
    const timer: ReturnType<typeof setTimeout> = setTimeout((): void => { signal.removeEventListener("abort", abort); resolve(); }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
  });
}

/** 후속 학습 엔진은 최신 DB 조회 함수를 전달하며 가격·자금·지원 증거는 서버에서 고정합니다. */
export async function runOwnerAiRequest(input: Omit<AiRunInput, "pricing">, loadContext: CompletionRuntime["loadContext"], signal: AbortSignal): Promise<AiRunOutcome> {
  await authenticateAiOwner();
  const configuration: AiConfiguration = requireAiConfiguration(env.ALTER_AI_CONFIGURATION);
  return runAiRequest({ ...ownerAiRuntime(configuration), loadContext, wait: waitForRetry, warn: (warning: RetryWarning): void => console.warn(warning), requireSupport: async (owner, prepared, now): Promise<void> => {
    if (owner.userId !== configuration.funding.ownerId) throw new Error("AI 자금 설정의 소유자가 다릅니다.");
    requireAiSupport(configuration.support, prepared.imageCount > 0 ? ["text", "image", "structured-output", "usage", "output-limit"] : ["text", "structured-output", "usage", "output-limit"], configuration.funding.accountFingerprint, now);
  } }, { ...input, pricing: configuration.pricing }, signal);
}

/** 실제 계정의 첫 검사는 고정 검사 자료만 보내며 일반 학습 호출의 지원 검사를 해제하지 않습니다. */
export async function checkOwnerAiSupport(signal: AbortSignal): Promise<AiSupportProbeReport> {
  await authenticateAiOwner();
  const configuration: AiConfiguration = requireAiConfiguration(env.ALTER_AI_CONFIGURATION);
  if (!env.OPENAI_API_KEY) throw Object.assign(new Error("AI 설정 누락: OPENAI_API_KEY"), { code: "ai_key_required" });
  await requireConfiguredKey(env.OPENAI_API_KEY, configuration.credentialFingerprint);
  return runAiSupportProbe({ ...ownerAiRuntime(configuration), loadContext: async () => { throw new Error("고정 검사 문맥이 필요합니다."); }, wait: waitForRetry, warn: (warning: RetryWarning): void => console.warn(warning) }, configuration, "hosted-worker", signal);
}
