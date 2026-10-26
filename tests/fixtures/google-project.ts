import type { GoogleProjectEvidence, GoogleStorageEvidence } from "../../lib/google/project.ts";

export function fixtureGoogleProject(now: number): GoogleProjectEvidence {
  const proof: GoogleProjectEvidence["apis"]["drive"] = { enabled: true, freeWithinVerifiedLimits: true, limitsVerified: true, source: "https://developers.google.com/workspace/tools-safety", checkedAt: now, validUntil: now + 60_000 };
  return { ownerId: "owner", projectId: "alter-fixture", projectNumber: "123456789", consoleSource: "https://console.cloud.google.com/apis/dashboard?project=alter-fixture", checkedAt: now, validUntil: now + 60_000, billingAccountLinked: false, paidQuotaExpansion: "disabled", apis: { sheets: { ...proof }, docs: { ...proof }, calendar: { ...proof }, drive: { ...proof }, picker: { ...proof } } };
}
export function fixtureGoogleStorage(now: number): GoogleStorageEvidence {
  return { ownerId: "owner", projectId: "alter-fixture", googleSubject: "google-subject", state: "verified", limitBytes: "15000000000", usedBytes: "1000000000", source: "https://developers.google.com/workspace/drive/api/reference/rest/v3/about", checkedAt: now, validUntil: now + 60_000 };
}
