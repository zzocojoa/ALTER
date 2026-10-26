import { z } from "zod";
import type { SiteIdentity } from "../domain/contracts.ts";
import { readManagedGoogleToken } from "../../db/repositories/google-managed.ts";
import { beginRestoreGoogleRead, finishRestoreGoogleRead, requireRestoreRead, reserveRestoreGoogleRead } from "../../db/repositories/restore-reconciliation.ts";
import { decryptGoogleTokenBundle } from "../google/token-crypto.ts";
import { googleFailure } from "../google/errors.ts";
import { boundGoogleResponseQuota, prepareGoogleQuota } from "../google/quota.ts";
import { prepareGoogleRestRequest } from "../google/rest-request.ts";
import type { GoogleRestInput } from "../google/rest-request.ts";
import { requireGoogleResourceGrant } from "../google/permissions.ts";
import type { GoogleResourceRole } from "../google/permissions.ts";
import { verifyGoogleFile } from "../google/resources.ts";
import { googleRestRetryDelay, sendGoogleRestAttempt } from "../google/rest-transport.ts";
import type { GoogleRestFailure, GoogleRestRuntime } from "../google/rest-transport.ts";
import type { GoogleExecutionResult, GoogleExecutionSettings } from "../google/execute.ts";
import type { GoogleObservationReader } from "../external/google-read.ts";
import type { ExternalCallContext } from "../external/execute.ts";

type RestoredReadSettings = Readonly<{ db: D1Database; owner: SiteIdentity; reconciliationId: string; settings: GoogleExecutionSettings; runtime: GoogleRestRuntime }>;
const readMethods: readonly string[] = ["drive.files.get", "drive.files.list", "docs.documents.get", "sheets.spreadsheets.get", "sheets.values.get", "calendar.calendars.get", "calendar.events.get"];
async function historicalResource(input: RestoredReadSettings, connectionId: string, externalId: string, role: GoogleResourceRole): Promise<Readonly<{ approvedAt: number; appCreated: boolean }>> {
  const sql: string = role === "folder-target" ? "SELECT approved_at AS approvedAt,'app-created' AS source FROM google_report_folders WHERE owner_id=? AND connection_id=? AND external_id=? ORDER BY approved_at DESC LIMIT 1" : "SELECT approved_at AS approvedAt,source FROM google_resources WHERE owner_id=? AND connection_id=? AND external_id=? AND role=? ORDER BY approved_at DESC LIMIT 1";
  const params: string[] = [input.owner.userId, connectionId, externalId];
  const row = await input.db.prepare(sql).bind(...(role === "folder-target" ? params : [...params, role])).first<{ approvedAt: number; source: string }>();
  if (row === null || !["app-created", "picker"].includes(row.source) || role === "calendar-target" && row.source !== "app-created") throw googleFailure("google_scope_denied", "restore.read.historical-resource");
  return { approvedAt: row.approvedAt, appCreated: row.source === "app-created" };
}
/** 현재 새 토큰과 읽기 예약만 사용하며 과거 인증 세대에 쓰기 권한을 다시 부여하지 않습니다. */
async function readAttempt(input: RestoredReadSettings, context: ExternalCallContext, value: GoogleRestInput, role: GoogleResourceRole, requestId: string): Promise<GoogleExecutionResult> {
  await context.beforeCall(); const now: number = input.runtime.now();
  const access = await requireRestoreRead(input.db, input.owner, input.reconciliationId, now);
  if (context.operation.id !== access.operation.id || context.operation.version !== access.operation.version) throw googleFailure("google_scope_denied", "restore.read.operation");
  const request = await prepareGoogleRestRequest(value, role);
  if (!readMethods.includes(request.method) || request.httpMethod !== "GET" || request.body !== null || request.externalId === null) throw googleFailure("google_scope_denied", "restore.read.get-only");
  const plan = boundGoogleResponseQuota(await prepareGoogleQuota(input.settings.quota, input.settings.project, input.owner.userId, access.connection.googleSubject, request.method, now), request.maximumBytes);
  const historicalProject = await input.db.prepare("SELECT project_id FROM google_quota_policies WHERE owner_id=? AND project_id=?").bind(input.owner.userId, plan.projectId).first();
  if (historicalProject === null || plan.checkedAt < access.activatedAt) throw googleFailure("google_quota_unverified", "restore.read.project-evidence");
  const grant = await historicalResource(input, access.connection.connectionId, request.externalId, role);
  requireGoogleResourceGrant({ ownerId: input.owner.userId, connectionId: access.connection.connectionId, generation: access.connection.generation, role, externalId: request.externalId, appCreated: grant.appCreated, approvedAt: grant.approvedAt, checkedAt: now, validUntil: now + 30_000 }, input.owner.userId, access.connection.connectionId, access.connection.generation, request.method, access.connection.scopes, request.externalId, now);
  if (!["calendar-target", "folder-target"].includes(role) && request.method !== "drive.files.get") {
    if (role !== "docs-target" && role !== "sheets-target") throw googleFailure("google_scope_denied", "restore.read.role");
    const metadata = await readWithRetry(input, context, { method: "drive.files.get", fileId: request.externalId }, role, crypto.randomUUID());
    verifyGoogleFile(metadata.data, request.externalId, role, input.runtime.now());
  }
  const stored = await readManagedGoogleToken(input.db, input.owner, access.connection);
  const token = await decryptGoogleTokenBundle(stored.token, { ownerId: input.owner.userId, connectionId: access.connection.connectionId, generation: access.connection.generation }, input.settings.credentials.keyring);
  await reserveRestoreGoogleRead(input.db, input.owner, input.reconciliationId, requestId, request, input.settings.quota, plan, input.runtime.now());
  await context.beforeCall(); await beginRestoreGoogleRead(input.db, input.owner, requestId, input.runtime.now());
  let result: GoogleExecutionResult;
  try { result = { ...await sendGoogleRestAttempt(input.runtime, request, token.accessToken), attemptId: requestId }; }
  catch (error: unknown) {
    const failure = error instanceof Error && "code" in error && error.code === "google_rest_failed" ? error as GoogleRestFailure : null;
    await finishRestoreGoogleRead(input.db, input.owner, requestId, failure?.outcome ?? "unknown", failure?.status ?? null, failure?.reason ?? "unexpected-response-failure", input.runtime.now()); throw error;
  }
  await finishRestoreGoogleRead(input.db, input.owner, requestId, "succeeded", result.status, null, input.runtime.now()); await context.beforeCall(); return result;
}
async function readWithRetry(input: RestoredReadSettings, context: ExternalCallContext, value: GoogleRestInput, role: GoogleResourceRole, requestId: string): Promise<GoogleExecutionResult> {
  const request = await prepareGoogleRestRequest(value, role);
  for (let attempt: number = 1; attempt <= 3; attempt += 1) {
    try { return await readAttempt(input, context, value, role, attempt === 1 ? requestId : crypto.randomUUID()); }
    catch (error: unknown) {
      if (!(error instanceof Error && "code" in error && error.code === "google_rest_failed")) throw error;
      const failure = error as GoogleRestFailure; const delay: number | null = googleRestRetryDelay(request, failure, attempt);
      if (delay === null) throw error;
      input.runtime.warn({ event: "google_rest_retry", method: request.method, requestHash: request.hash, attempt, status: failure.status, reason: failure.reason, waitMs: delay }); await input.runtime.wait(delay);
    }
  }
  throw googleFailure("google_request_unknown", "restore.read.retry-exhausted");
}
export function restoredGoogleObservationReader(db: D1Database, owner: SiteIdentity, reconciliationId: string, settings: GoogleExecutionSettings, runtime: GoogleRestRuntime): GoogleObservationReader {
  z.string().uuid().parse(reconciliationId);
  const input: RestoredReadSettings = { db, owner, reconciliationId, settings, runtime };
  return { db, owner, now: runtime.now, call: (context, value, role, requestId) => readWithRetry(input, context, value, role, requestId) };
}
