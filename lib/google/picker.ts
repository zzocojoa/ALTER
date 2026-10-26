import { z } from "zod";
import { contentHash, recordId, timestamp, version } from "../domain/contracts.ts";
import { googleEvidenceIsCurrent } from "./project.ts";
import type { GoogleProjectEvidence } from "./project.ts";
import { googleFailure } from "./errors.ts";
import { requireGoogleMethodScope } from "./permissions.ts";
import type { ManagedGoogleConnection } from "../../db/repositories/google-managed.ts";

export const googlePickerEvidence = z.object({
  ownerId: z.string().min(1).max(200), projectId: z.string(), projectNumber: z.string().regex(/^[1-9]\d+$/), origin: z.string().url(),
  keyFingerprint: z.string().regex(/^[a-f0-9]{64}$/), websiteRestrictions: z.array(z.string()).min(2).max(10), apiRestrictions: z.tuple([z.literal("picker.googleapis.com")]),
  checkedAt: timestamp, validUntil: timestamp,
}).strict();
export type GooglePickerEvidence = Readonly<z.infer<typeof googlePickerEvidence>>;
export const googlePickerCredentials = z.object({ leaseId: recordId, connectionId: recordId, generation: version, projectNumber: z.string().regex(/^[1-9]\d+$/), origin: z.string().url(), apiKey: z.string().min(20).max(200), accessToken: z.string().min(1).max(8192), tokenExpiresAt: timestamp, leaseExpiresAt: timestamp }).strict();
export type GooglePickerCredentials = Readonly<z.infer<typeof googlePickerCredentials>>;
export const googlePickerSelection = z.object({ leaseId: recordId, connectionId: recordId, generation: version, fileId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/), role: z.enum(["reference", "docs-target", "sheets-target"]) }).strict();
export type GooglePickerSelection = Readonly<z.infer<typeof googlePickerSelection>>;

/** Picker iframe의 공식 referrer를 포함하되 광역 도메인·다른 프로젝트 키는 허용하지 않습니다. */
export async function requireGooglePickerEvidence(value: GooglePickerEvidence, project: GoogleProjectEvidence, apiKey: string, ownerId: string, origin: string, now: number): Promise<void> {
  timestamp.parse(now);
  const parsed = googlePickerEvidence.safeParse(value);
  if (!parsed.success) throw googleFailure("google_configuration_invalid", "picker-settings");
  const evidence: GooglePickerEvidence = parsed.data;
  const url: URL = new URL(evidence.origin);
  if (evidence.ownerId !== ownerId || project.ownerId !== ownerId || evidence.projectId !== project.projectId || evidence.projectNumber !== project.projectNumber || evidence.origin !== origin || url.origin !== origin || !googleEvidenceIsCurrent(evidence.checkedAt, evidence.validUntil, now) || await contentHash(apiKey) !== evidence.keyFingerprint) throw googleFailure("google_oauth_unverified", "picker-project-origin-key");
  if (evidence.websiteRestrictions.length !== 2 || !evidence.websiteRestrictions.includes(`${origin}/*`) || !evidence.websiteRestrictions.includes("https://docs.google.com/*")) throw googleFailure("google_oauth_unverified", "picker-key-restrictions");
}

/** 제공사의 실제 토큰 만료와 Picker 선택 시도 만료를 구분하며 refresh token을 받지 않습니다. */
export function prepareGooglePickerCredentials(connection: ManagedGoogleConnection, evidence: GooglePickerEvidence, apiKey: string, accessToken: string, leaseId: string, now: number): GooglePickerCredentials {
  if (!["active", "partial"].includes(connection.state) || connection.accessExpiresAt <= now + 30_000 || connection.accessExpiresAt > now + 3_600_000) throw googleFailure("google_connection_unavailable", "picker-token-expiry");
  requireGoogleMethodScope("picker.open", connection.scopes);
  return googlePickerCredentials.parse({ leaseId, connectionId: connection.connectionId, generation: connection.generation, projectNumber: evidence.projectNumber, origin: evidence.origin, apiKey, accessToken, tokenExpiresAt: connection.accessExpiresAt, leaseExpiresAt: Math.min(now + 60_000, connection.accessExpiresAt) });
}
