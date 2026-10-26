import { z } from "zod";
import { timestamp } from "../domain/contracts.ts";
import { googleApis, googleEvidenceIsCurrent, googleProjectEvidence, googleProjectId, requireGoogleProject } from "./project.ts";
import { googleFailure } from "./errors.ts";

export const googleOAuthEvidence = z.object({
  ownerId: z.string().min(1).max(200), projectId: googleProjectId,
  clientId: z.string().regex(/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/), clientType: z.literal("web"),
  environment: z.enum(["development", "production"]), origin: z.string().url(), callbackUrl: z.string().url(),
  registeredOrigins: z.array(z.string().url()).min(1).max(10), registeredCallbacks: z.array(z.string().url()).min(1).max(10),
  audience: z.literal("external"), publishing: z.enum(["testing", "production", "unknown"]),
  approvedTestEmails: z.array(z.string().email().max(254)).max(100),
  verification: z.enum(["verified", "not-required", "unverified"]),
  consoleSource: z.string().url(), checkedAt: timestamp, validUntil: timestamp,
}).strict();
export type GoogleOAuthEvidence = Readonly<z.infer<typeof googleOAuthEvidence>>;
export const googleConfiguration = z.object({ project: googleProjectEvidence, oauth: googleOAuthEvidence }).strict();
export type GoogleConfiguration = Readonly<z.infer<typeof googleConfiguration>>;

/** 서버 비밀 설정만 읽으며 JSON 오류에 원문이나 인증 정보를 넣지 않습니다. */
export function requireGoogleConfiguration(raw: string | undefined): GoogleConfiguration {
  if (!raw) throw googleFailure("google_configuration_invalid", "configuration-missing");
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch (error: unknown) { if (error instanceof SyntaxError) throw googleFailure("google_configuration_invalid", "configuration-json"); throw error; }
  const parsed = googleConfiguration.safeParse(value);
  if (!parsed.success) throw googleFailure("google_configuration_invalid", "configuration-schema");
  return parsed.data;
}

/** 외부 복귀 주소를 입력받지 않고 서버 설정의 독립 callback만 사용합니다. */
export function requireGoogleOAuth(configuration: GoogleConfiguration, ownerId: string, siteOrigin: string, clientId: string, now: number): GoogleOAuthEvidence {
  const parsed = googleOAuthEvidence.safeParse(configuration.oauth);
  if (!parsed.success) throw googleFailure("google_configuration_invalid", "oauth-schema");
  const oauth: GoogleOAuthEvidence = parsed.data;
  requireGoogleProject(configuration.project, ownerId, oauth.projectId, googleApis, now);
  const origin: URL = new URL(oauth.origin);
  const consoleUrl: URL = new URL(oauth.consoleSource);
  const local: boolean = origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname);
  if (oauth.ownerId !== ownerId || oauth.clientId !== clientId || oauth.origin !== siteOrigin || origin.origin !== oauth.origin || oauth.environment === "production" && origin.protocol !== "https:" || oauth.environment === "development" && !local || oauth.callbackUrl !== `${oauth.origin}/api/google/oauth/callback`) throw googleFailure("google_oauth_unverified", "oauth-address");
  if (!oauth.registeredOrigins.includes(oauth.origin) || !oauth.registeredCallbacks.includes(oauth.callbackUrl) || !googleEvidenceIsCurrent(oauth.checkedAt, oauth.validUntil, now) || consoleUrl.protocol !== "https:" || consoleUrl.hostname !== "console.cloud.google.com" || consoleUrl.username || consoleUrl.password || consoleUrl.searchParams.get("project") !== oauth.projectId) throw googleFailure("google_oauth_unverified", "oauth-console");
  if (oauth.publishing === "unknown" || oauth.verification === "unverified" || oauth.publishing === "testing" && oauth.approvedTestEmails.length === 0) throw googleFailure("google_oauth_unverified", "oauth-publishing");
  return oauth;
}

/** Google 이메일은 테스트 사용자 등록만 확인하며 Sites 로그인 이메일과 비교하지 않습니다. */
export function requireGoogleTestAccount(oauth: GoogleOAuthEvidence, verifiedGoogleEmail: string): void {
  if (oauth.publishing === "unknown" || oauth.publishing === "testing" && !oauth.approvedTestEmails.includes(verifiedGoogleEmail)) throw googleFailure("google_oauth_unverified", "oauth-test-user");
}

/** 최초 동의 시각을 기준으로 계산하며 refresh 실행 때 7일을 다시 더하지 않습니다. */
export function googleRefreshDeadline(issuedAt: number, publishing: "testing" | "production", providerLifetimeSeconds: number | null): number | null {
  timestamp.parse(issuedAt);
  if (providerLifetimeSeconds !== null) z.number().int().positive().max(Math.floor((Number.MAX_SAFE_INTEGER - issuedAt) / 1000)).parse(providerLifetimeSeconds);
  const providerDeadline: number | null = providerLifetimeSeconds === null ? null : issuedAt + providerLifetimeSeconds * 1000;
  if (publishing === "production") return providerDeadline;
  const testingDeadline: number = timestamp.parse(issuedAt + 7 * 24 * 60 * 60 * 1000);
  return providerDeadline === null ? testingDeadline : Math.min(testingDeadline, providerDeadline);
}
