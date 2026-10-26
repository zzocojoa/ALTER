import { assembleGoogleApiConfiguration, requireGoogleApiConfiguration } from "./api-settings";
import { googleFailure } from "./errors";
import type { GoogleExecutionRuntime, GoogleExecutionSettings } from "./execute";
import type { GooglePickerEvidence } from "./picker";
import { env } from "cloudflare:workers";
import { z } from "zod";
import type { SiteIdentity } from "../domain/contracts";
import { materialErrorResponse } from "../materials/server-access";
import { privateJson } from "../owner-access";
import { requireGoogleSettings } from "../runtime-settings";
import { isDomainFailure } from "../../db/repositories/atomic";
import { readManagedGoogleConnection } from "../../db/repositories/google-managed";
import { requireGoogleConfiguration, requireGoogleOAuth } from "./oauth-configuration";
import type { GoogleOAuthEvidence } from "./oauth-configuration";
import { requireGoogleTokenKeyring } from "./token-crypto";
import type { GoogleTokenKeyring } from "./token-crypto";
import type { GoogleOAuthRuntime } from "./oauth-exchange";
import type { GoogleConnectionView } from "./view";

export type GoogleServerSettings = Readonly<{ oauth: GoogleOAuthEvidence; clientId: string; clientSecret: string; keyring: GoogleTokenKeyring }>;
export function googleServerSettings(owner: SiteIdentity): GoogleServerSettings {
  const configuration = requireGoogleConfiguration(env.ALTER_GOOGLE_CONFIGURATION);
  const settings = requireGoogleSettings(env);
  const oauth = requireGoogleOAuth(configuration, owner.userId, env.ALTER_SITE_ORIGIN ?? "", settings.clientId, Date.now());
  return { oauth, clientId: settings.clientId, clientSecret: settings.clientSecret, keyring: requireGoogleTokenKeyring(settings.tokenEncryptionKey) };
}
export function googleOAuthRuntime(): GoogleOAuthRuntime {
  return { fetch: (url, options) => fetch(url, options), now: Date.now, wait: async milliseconds => { await new Promise<void>(resolve => setTimeout(resolve, milliseconds)); }, warn: warning => console.warn(warning) };
}
export async function readGoogleConnectionView(owner: SiteIdentity): Promise<GoogleConnectionView> {
  let configurationIssue: string | null = null;
  try { googleServerSettings(owner); }
  catch (error: unknown) {
    if (error instanceof Error && (error.name === "GoogleFailure" || error instanceof TypeError && error.message.startsWith("Google 연결 설정 누락:"))) configurationIssue = "Google 연결 준비가 필요해요. 사용할 계정과 무료 이용 조건을 확인한 뒤 연결할 수 있어요.";
    else throw error;
  }
  const current = await readManagedGoogleConnection(env.DB, owner);
  return { configured: configurationIssue === null, configurationIssue, connection: current === null ? null : { connectionId: current.connectionId, generation: current.generation, email: current.googleEmail, state: current.state, filesAllowed: current.scopes.includes("https://www.googleapis.com/auth/drive.file"), calendarAllowed: current.scopes.includes("https://www.googleapis.com/auth/calendar.app.created"), refreshExpiresAt: current.refreshExpiresAt, providerRevocation: current.providerRevocation } };
}
export function googleErrorResponse(error: unknown): Response {
  if (error instanceof Error && "code" in error && error.code === "google_rest_failed" && "method" in error && "reason" in error && "status" in error && "requestHash" in error) return privateJson({ error: error.code, method: error.method, reason: error.reason, providerStatus: error.status, requestHash: error.requestHash, message: error.message }, 502);
  if (error instanceof z.ZodError) return privateJson({ error: "google_input_invalid", message: "요청한 연결 정보와 현재 상태를 확인해 주세요." }, 400);
  if (error instanceof Error && error.name === "GoogleFailure" && "code" in error && "operation" in error) return privateJson({ error: error.code, operation: error.operation, message: error.message }, 409);
  if (error instanceof Error && "code" in error && error.code === "google_oauth_transport_failed") return privateJson({ error: error.code, message: "Google 인증 응답을 확인하지 못했어요. 연결 상태를 새로 확인해 주세요." }, 503);
  if (error instanceof TypeError && error.message.startsWith("Google 연결 설정 누락:")) return privateJson({ error: "google_configuration_invalid", message: "Google 연결 설정이 아직 준비되지 않았어요." }, 503);
  if (isDomainFailure(error)) return privateJson({ error: error.code, operation: error.operation, message: "Google 연결 상태가 바뀌었거나 저장 결과를 확인하지 못했어요. 상태를 새로 확인해 주세요." }, error.code === "storage_failure" || error.code === "result_unknown" ? 503 : 409);
  return materialErrorResponse(error);
}

export function googleApiServerSettings(owner: SiteIdentity): Readonly<{ execution: GoogleExecutionSettings; picker: GooglePickerEvidence; apiKey: string }> {
  const settings = googleServerSettings(owner);
  const configuration = requireGoogleConfiguration(env.ALTER_GOOGLE_CONFIGURATION);
  const api = requireGoogleApiConfiguration(assembleGoogleApiConfiguration(env.ALTER_GOOGLE_API_CONFIGURATION, [env.ALTER_GOOGLE_API_CONFIGURATION_1, env.ALTER_GOOGLE_API_CONFIGURATION_2, env.ALTER_GOOGLE_API_CONFIGURATION_3, env.ALTER_GOOGLE_API_CONFIGURATION_4]));
  if (!env.GOOGLE_PICKER_API_KEY) throw googleFailure("google_configuration_invalid", "picker-api-key-missing");
  return { execution: { credentials: { clientId: settings.clientId, clientSecret: settings.clientSecret, keyring: settings.keyring }, project: configuration.project, quota: api.quota }, picker: api.picker, apiKey: env.GOOGLE_PICKER_API_KEY };
}
export function googleExecutionRuntime(): GoogleExecutionRuntime {
  return { oauth: googleOAuthRuntime(), rest: { fetch: (url, options) => fetch(url, options), now: Date.now, wait: async milliseconds => { await new Promise<void>(resolve => setTimeout(resolve, milliseconds)); }, warn: warning => console.warn(warning) } };
}
