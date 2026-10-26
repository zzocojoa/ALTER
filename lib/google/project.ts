import { z } from "zod";
import { timestamp } from "../domain/contracts.ts";
import { googleFailure } from "./errors.ts";

export const googleApis = ["sheets", "docs", "calendar", "drive", "picker"] as const;
export type GoogleApi = typeof googleApis[number];
export const googleProjectId = z.string().regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/);
const byteCount = z.string().regex(/^(0|[1-9]\d{0,18})$/).refine((value: string): boolean => BigInt(value) <= BigInt("9223372036854775807"));
const officialSource = z.string().url().refine((value: string): boolean => {
  const url: URL = new URL(value);
  return url.protocol === "https:" && ["developers.google.com", "console.cloud.google.com", "one.google.com"].includes(url.hostname) && !url.username && !url.password;
});
const apiEvidence = z.object({ enabled: z.boolean().nullable(), freeWithinVerifiedLimits: z.boolean().nullable(), limitsVerified: z.boolean(), source: officialSource, checkedAt: timestamp, validUntil: timestamp }).strict();
export const googleProjectEvidence = z.object({
  ownerId: z.string().min(1).max(200), projectId: googleProjectId, projectNumber: z.string().regex(/^[1-9]\d{0,29}$/),
  consoleSource: officialSource, checkedAt: timestamp, validUntil: timestamp,
  billingAccountLinked: z.boolean().nullable(), paidQuotaExpansion: z.enum(["disabled", "enabled", "unknown"]),
  apis: z.object({ sheets: apiEvidence, docs: apiEvidence, calendar: apiEvidence, drive: apiEvidence, picker: apiEvidence }).strict(),
}).strict();
export type GoogleProjectEvidence = Readonly<z.infer<typeof googleProjectEvidence>>;
export const googleStorageEvidence = z.object({
  ownerId: z.string().min(1).max(200), projectId: googleProjectId, googleSubject: z.string().min(1).max(200),
  state: z.enum(["verified", "unknown"]), limitBytes: byteCount.nullable(), usedBytes: byteCount.nullable(),
  source: officialSource, checkedAt: timestamp, validUntil: timestamp,
}).strict();
export type GoogleStorageEvidence = Readonly<z.infer<typeof googleStorageEvidence>>;

export function googleEvidenceIsCurrent(checkedAt: number, validUntil: number, now: number): boolean {
  return checkedAt <= now && now < validUntil && validUntil > checkedAt && validUntil - checkedAt <= 24 * 60 * 60 * 1000;
}

/** 공식 문서만으로 실제 프로젝트 활성화나 무료 한도 확인을 대신하지 않습니다. */
export function requireGoogleProject(value: GoogleProjectEvidence, ownerId: string, projectId: string, requiredApis: readonly GoogleApi[], now: number): GoogleProjectEvidence {
  timestamp.parse(now);
  const parsed = googleProjectEvidence.safeParse(value);
  if (!parsed.success) throw googleFailure("google_configuration_invalid", "project");
  const evidence: GoogleProjectEvidence = parsed.data;
  const consoleUrl: URL = new URL(evidence.consoleSource);
  if (evidence.ownerId !== ownerId || evidence.projectId !== projectId || !googleEvidenceIsCurrent(evidence.checkedAt, evidence.validUntil, now) || consoleUrl.hostname !== "console.cloud.google.com" || consoleUrl.searchParams.get("project") !== projectId) throw googleFailure("google_project_unverified", "project");
  if (evidence.billingAccountLinked === null || evidence.paidQuotaExpansion !== "disabled") throw googleFailure("google_free_conditions_unverified", "project");
  if (requiredApis.length === 0 || new Set(requiredApis).size !== requiredApis.length || requiredApis.some((api: GoogleApi): boolean => !googleApis.includes(api))) throw googleFailure("google_configuration_invalid", "project");
  for (const api of requiredApis) {
    const proof: GoogleProjectEvidence["apis"][GoogleApi] = evidence.apis[api];
    if (proof.enabled !== true) throw googleFailure("google_api_disabled", api);
    if (!googleEvidenceIsCurrent(proof.checkedAt, proof.validUntil, now) || proof.freeWithinVerifiedLimits !== true || !proof.limitsVerified) throw googleFailure("google_free_conditions_unverified", api);
  }
  return evidence;
}

/** OAuth 전에는 저장 용량이 미확인일 수 있지만 업무 호출 전에는 계정에 결합된 증거가 필요합니다. */
export function requireGoogleStorage(value: GoogleStorageEvidence, ownerId: string, projectId: string, googleSubject: string, reservedBytes: string, requiredBytes: string, now: number): void {
  timestamp.parse(now);
  const parsed = googleStorageEvidence.safeParse(value);
  if (!parsed.success || !byteCount.safeParse(reservedBytes).success || !byteCount.safeParse(requiredBytes).success) throw googleFailure("google_configuration_invalid", "storage");
  const evidence: GoogleStorageEvidence = parsed.data;
  if (evidence.ownerId !== ownerId || evidence.projectId !== projectId || evidence.googleSubject !== googleSubject || evidence.state !== "verified" || evidence.limitBytes === null || evidence.usedBytes === null || !googleEvidenceIsCurrent(evidence.checkedAt, evidence.validUntil, now)) throw googleFailure("google_storage_unverified", "storage");
  const limit: bigint = BigInt(evidence.limitBytes);
  const occupied: bigint = BigInt(evidence.usedBytes) + BigInt(reservedBytes);
  if (occupied >= limit || occupied + BigInt(requiredBytes) > limit) throw googleFailure("google_storage_exhausted", "storage");
}
