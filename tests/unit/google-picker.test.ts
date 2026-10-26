import { describe, expect, it } from "vitest";
import { contentHash, recordId } from "../../lib/domain/contracts.ts";
import { prepareGooglePickerCredentials, requireGooglePickerEvidence } from "../../lib/google/picker.ts";
import type { GooglePickerEvidence } from "../../lib/google/picker.ts";
import type { ManagedGoogleConnection } from "../../db/repositories/google-managed.ts";
import { googleRequestedScopes } from "../../lib/google/permissions.ts";
import { fixtureGoogleProject } from "../fixtures/google-project.ts";

const now: number = Date.parse("2026-10-25T00:00:00Z");
const apiKey: string = "fixture-browser-api-key-not-real";
const project = fixtureGoogleProject(now);
const picker: GooglePickerEvidence = { ownerId: "owner", projectId: project.projectId, projectNumber: project.projectNumber, origin: "https://alter.example.test", keyFingerprint: await contentHash(apiKey), websiteRestrictions: ["https://alter.example.test/*", "https://docs.google.com/*"], apiRestrictions: ["picker.googleapis.com"], checkedAt: now, validUntil: now + 60_000 };
const id = recordId.parse("00000000-0000-4000-a000-000000001400");
const connection: ManagedGoogleConnection = { id, version: 1, connectionId: id, connectionVersion: 1, generation: 1, state: "active", googleSubject: "subject", googleEmail: "google@example.test", scopes: googleRequestedScopes, accessExpiresAt: now + 3600_000, authorizedAt: now, refreshExpiresAt: now + 604_800_000, refreshLeaseId: null, refreshLeaseExpiresAt: null, storageEvidence: null, providerRevocation: "none" };

describe("Google Picker 전달 경계", () => {
  it("프로젝트·origin·제한된 API key의 실제 확인 근거를 요구한다", async () => {
    await expect(requireGooglePickerEvidence(picker, project, apiKey, "owner", picker.origin, now)).resolves.toBeUndefined();
    for (const change of [{ ownerId: "other" }, { projectId: "other-project" }, { projectNumber: "9999" }, { origin: "https://evil.test" }, { keyFingerprint: "a".repeat(64) }, { validUntil: now }, { websiteRestrictions: ["https://*.example.test/*", "https://docs.google.com/*"] }, { websiteRestrictions: ["https://alter.example.test/*", "https://drive.google.com/*"] }]) await expect(requireGooglePickerEvidence({ ...picker, ...change }, project, apiKey, "owner", picker.origin, now)).rejects.toThrow();
  });
  it("access token만 반환하고 선택 시도와 토큰 만료를 혼동하지 않는다", () => {
    const credentials = prepareGooglePickerCredentials(connection, picker, apiKey, "access-value", id, now);
    expect(credentials.tokenExpiresAt).toBe(now + 3600_000); expect(credentials.leaseExpiresAt).toBe(now + 60_000);
    expect(JSON.stringify(credentials)).not.toMatch(/refreshToken|clientSecret|keyring|ciphertext/);
  });
  it("해제·갱신중·scope누락·만료·비정상 장기 토큰은 전달하지 않는다", () => {
    for (const change of [{ state: "disconnected" as const }, { state: "refreshing" as const }, { scopes: ["openid", "email"] as const }, { accessExpiresAt: now + 30_000 }, { accessExpiresAt: now + 3600_001 }]) expect(() => prepareGooglePickerCredentials({ ...connection, ...change }, picker, apiKey, "access-value", id, now)).toThrow();
  });
});
