import type { GoogleQuotaDimension, GoogleQuotaPolicy } from "../../lib/google/quota.ts";
import type { GoogleStorageEvidence } from "../../lib/google/project.ts";

export function fixtureGoogleQuota(ownerId: string, now: number, projectLimit: number, userLimit: number): GoogleQuotaPolicy {
  const dimension = (scope: "project" | "user", limit: number): GoogleQuotaDimension => ({ metric: "read-minute", unit: "quota-units", scope, category: "rate", actions: ["read"], providerLimit: 100_000, appLimit: limit, window: { kind: "sliding", durationMs: 60_000, providerReset: "rolling" }, consoleUsedUpper: 0, consoleObservedAt: now, consoleWindowStart: now - 60_000, consoleWindowEnd: now, observation: "verified-upper-bound", source: "https://developers.google.com/workspace/drive/api/guides/limits" });
  const costs = [{ metric: "read-minute", scope: "project" as const, units: 5 }, { metric: "read-minute", scope: "user" as const, units: 5 }];
  return { ownerId, projectId: "alter-fixture-project", version: 1, dedicatedProject: true, checkedAt: now, validUntil: now + 3_600_000, apis: [{ api: "drive", dailyFree: "unlimited-verified", source: "https://developers.google.com/workspace/drive/api/guides/limits", dimensions: [dimension("project", projectLimit), dimension("user", userLimit)] }], methods: [{ method: "drive.about.get", costs, source: "https://developers.google.com/workspace/drive/api/reference/rest/v3/about/get" }, { method: "drive.files.get", costs, source: "https://developers.google.com/workspace/drive/api/reference/rest/v3/files/get" }] };
}
export function fixtureGoogleStorage(ownerId: string, subject: string, now: number): GoogleStorageEvidence {
  return { ownerId, projectId: "alter-fixture-project", googleSubject: subject, state: "verified", limitBytes: "1000000000", usedBytes: "0", source: "https://developers.google.com/workspace/drive/api/reference/rest/v3/about/get", checkedAt: now, validUntil: now + 3_600_000 };
}
