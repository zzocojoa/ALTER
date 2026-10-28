import { publicAiSupport } from "../../lib/dashboard/ai-support.ts";
import { readRestoredExecution } from "./restore-execution.ts";
import { contentHash, domainFailure, policy, siteIdentity } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import { pricingVersion } from "../../lib/ai/pricing.ts";
import { googleQuotaPolicy } from "../../lib/google/quota.ts";
import { googleStorageEvidence } from "../../lib/google/project.ts";
import { materialPolicy } from "../../lib/materials/policy.ts";
import { costWindowView, displayConfiguration, externalOperationView, externalWorkflowView, googleLimitView, googleUsageRow, publicFunding, usageDashboard } from "../../lib/dashboard/usage.ts";
import type { UsageDashboard } from "../../lib/dashboard/usage.ts";
import { readStorage } from "./atomic.ts";
import { seoulMonthWindow } from "./usage.ts";
import { readManagedGoogleConnection } from "./google-managed.ts";
import type { ManagedGoogleConnection } from "./google-managed.ts";
import { getMaterialUsage } from "./material-transfers.ts";

function requireBound(length: number, limit: number, operation: string): void {
  if (length > limit) throw domainFailure("limit_exceeded", operation, null);
}
async function readCosts(db: D1Database, owner: SiteIdentity, raw: string | undefined, now: number): Promise<UsageDashboard["ai"]> {
  const period = seoulMonthWindow(now); const configuration = displayConfiguration(raw, owner.userId);
  const rows = await readStorage("dashboard.cost-window", () => db.prepare("SELECT w.category,w.limit_units AS 'limit',w.settled_units AS settled,w.reserved_units AS reserved,coalesce(sum(CASE WHEN r.state='unknown' THEN r.amount_units ELSE 0 END),0) AS unknown,w.limit_units-w.settled_units-w.reserved_units AS remaining,w.period_start AS periodStart,w.reset_at AS resetAt FROM cost_windows w LEFT JOIN cost_reservations r ON r.owner_id=w.owner_id AND r.window_id=w.id WHERE w.owner_id=? AND w.period_start=? AND w.reset_at=? GROUP BY w.owner_id,w.id").bind(owner.userId, period.periodStart, period.resetAt).all());
  const history = await readStorage("dashboard.price-history", () => db.prepare("SELECT snapshot FROM ai_pricing_versions WHERE owner_id=? ORDER BY created_at DESC,id LIMIT 101").bind(owner.userId).all<{ snapshot: string }>());
  requireBound(history.results.length, 100, "dashboard.price-history-limit");
  const committed = await readStorage("dashboard.probe-commitment", () => db.prepare("SELECT coalesce(sum(json_extract(snapshot,'$.reservationUsdMicros')),0) AS amount FROM ai_funding_checks WHERE owner_id=? AND json_type(snapshot,'$.prepaidProbe')='object'").bind(owner.userId).first<number>("amount"));
  if (committed === null) throw domainFailure("storage_failure", "dashboard.probe-commitment-missing", null);
  return { support:publicAiSupport(configuration.value,now), model: policy.model, configuration: configuration.state, windows: rows.results.map(row => costWindowView.parse(row)), pricing: configuration.value?.pricing ?? null, pricingHistory: history.results.map(row => pricingVersion.parse(JSON.parse(row.snapshot))), funding: configuration.value ? publicFunding(configuration.value, now) : null, probeCommittedUsdMicros: committed, liveProviderBilling: null };
}
async function readGoogleLimits(db: D1Database, owner: SiteIdentity, connection: ManagedGoogleConnection | null, now: number): Promise<Readonly<{ limits: UsageDashboard["google"]["limits"]; pickerLimits: UsageDashboard["google"]["pickerLimits"] }>> {
  if (await readRestoredExecution(db, owner) !== null) return { limits: [], pickerLimits: [] };
  const rows = await readStorage("dashboard.google-policy", () => db.prepare("SELECT snapshot FROM google_quota_policies WHERE owner_id=? ORDER BY project_id LIMIT 6").bind(owner.userId).all<{ snapshot: string }>());
  requireBound(rows.results.length, 5, "dashboard.google-project-limit");
  const limits: UsageDashboard["google"]["limits"] = [];
  const pickerLimits: UsageDashboard["google"]["pickerLimits"] = [];
  for (const row of rows.results) {
    const saved = googleQuotaPolicy.parse(JSON.parse(row.snapshot));
    if (saved.ownerId !== owner.userId) throw domainFailure("reference_conflict", "dashboard.google-policy-owner", null);
    if (saved.pickerUsage) {
      const usage = saved.pickerUsage;
      const counts: (number | null)[] = [];
      for (const scope of ["project", "user"] as const) {
        const subject = scope === "project" ? "project" : connection?.googleSubject ?? null;
        const key = await contentHash({ api: "picker", metric: "browser-open-minute", unit: "picker-session", scope });
        const count = subject === null ? null : await readStorage("dashboard.picker-charges", () => db.prepare("SELECT coalesce(sum(weight),0) AS n FROM google_quota_charges WHERE owner_id=? AND project_id=? AND dimension_key=? AND subject=? AND reserved_at>=?").bind(owner.userId, saved.projectId, key, subject, Math.max(0, now - 120_000)).first<number>("n"));
        if (subject !== null && count === null) throw domainFailure("storage_failure", "dashboard.picker-charges-missing", null);
        counts.push(count);
      }
      if (counts[0] === null) throw domainFailure("storage_failure", "dashboard.picker-project-count", null);
      pickerLimits.push({ projectId: saved.projectId, projectSessionsPerMinute: usage.projectSessionsPerMinute, userSessionsPerMinute: usage.userSessionsPerMinute, queriesPerMinutePerUser: usage.provider.queriesPerMinutePerUser, projectCharged: counts[0], userCharged: counts[1], checkedAt: usage.provider.checkedAt, validUntil: Math.min(saved.validUntil, usage.provider.validUntil), current: saved.checkedAt <= now && saved.validUntil > now && usage.provider.checkedAt <= now && usage.provider.validUntil > now, source: usage.provider.consoleSource });
    }
    for (const api of saved.apis) for (const dimension of api.dimensions) {
      const window = dimension.window;
      const start = window.kind === "sliding" ? Math.max(0, now - window.durationMs - 30_000) : window.periodStart;
      const end = window.kind === "sliding" ? now + 30_000 : window.resetAt;
      const subject = dimension.scope === "project" ? "project" : connection?.googleSubject ?? null;
      const key = await contentHash({ api: api.api, metric: dimension.metric, unit: dimension.unit, scope: dimension.scope });
      const charged = subject === null ? null : await readStorage("dashboard.google-charges", () => db.prepare("SELECT coalesce(sum(weight),0) AS n FROM google_quota_charges WHERE owner_id=? AND project_id=? AND dimension_key=? AND subject=? AND reserved_at>=?").bind(owner.userId, saved.projectId, key, subject, start).first<number>("n"));
      if (subject !== null && charged === null) throw domainFailure("storage_failure", "dashboard.google-charges-missing", null);
      limits.push(googleLimitView.parse({ projectId: saved.projectId, policyVersion: saved.version, api: api.api, metric: dimension.metric, unit: dimension.unit, scope: dimension.scope, appLimit: dimension.appLimit, providerLimit: dimension.providerLimit, appCharged: charged, consoleUpper: dimension.consoleUsedUpper, current: saved.checkedAt <= now && saved.validUntil > now && start <= now && end > now, checkedAt: dimension.consoleObservedAt, validUntil: Math.min(saved.validUntil, end), windowStart: start, windowEnd: end, source: dimension.source }));
    }
  }
  return { limits, pickerLimits };
}
async function readGoogleUsage(db: D1Database, owner: SiteIdentity, now: number): Promise<UsageDashboard["google"]> {
  const connection = await readManagedGoogleConnection(db, owner);
  const methods = await readStorage("dashboard.google-methods", () => db.prepare("SELECT project_id AS projectId,method,count(*) AS reservations,sum(CASE WHEN sent_at IS NOT NULL THEN 1 ELSE 0 END) AS sent,sum(CASE WHEN state='succeeded' THEN 1 ELSE 0 END) AS succeeded,sum(CASE WHEN state='failed' THEN 1 ELSE 0 END) AS failed,sum(CASE WHEN state IN ('reserved','sending','unknown') THEN 1 ELSE 0 END) AS unknown,max(sent_at) AS lastSentAt FROM google_requests WHERE owner_id=? GROUP BY project_id,method ORDER BY project_id,method LIMIT 251").bind(owner.userId).all());
  requireBound(methods.results.length, 250, "dashboard.google-method-limit");
  const blocks = await readStorage("dashboard.google-blocks", () => db.prepare("SELECT b.api,b.reason,b.blocked_until AS until FROM google_provider_blocks b JOIN google_quota_policies p ON p.owner_id=b.owner_id AND p.project_id=b.project_id WHERE b.owner_id=? AND b.policy_version>=p.version AND (b.blocked_until IS NULL OR b.blocked_until>?) ORDER BY b.api LIMIT 101").bind(owner.userId, now).all());
  requireBound(blocks.results.length, 100, "dashboard.google-block-limit");
  const quotas = await readGoogleLimits(db, owner, connection, now);
  const evidence = connection?.storageEvidence ? googleStorageEvidence.parse(JSON.parse(connection.storageEvidence)) : null;
  if (evidence && (evidence.ownerId !== owner.userId || evidence.googleSubject !== connection?.googleSubject)) throw domainFailure("reference_conflict", "dashboard.google-storage-owner", null);
  const reserved = evidence ? await readStorage("dashboard.google-storage-reserved", () => db.prepare("SELECT coalesce(sum(storage_bytes),0) AS n FROM google_requests WHERE owner_id=? AND project_id=? AND google_subject=? AND (reserved_at>=? OR state IN ('reserved','sending','unknown'))").bind(owner.userId, evidence.projectId, evidence.googleSubject, evidence.checkedAt).first<number>("n")) : null;
  if (evidence && reserved === null) throw domainFailure("storage_failure", "dashboard.google-storage-reserved", null);
  return usageDashboard.shape.google.parse({ connection: connection ? { email: connection.googleEmail, state: connection.state, refreshExpiresAt: connection.refreshExpiresAt, filesAllowed: connection.scopes.includes("https://www.googleapis.com/auth/drive.file"), calendarAllowed: connection.scopes.includes("https://www.googleapis.com/auth/calendar.app.created"), providerRevocation: connection.providerRevocation } : null, methods: methods.results.map(row => googleUsageRow.parse(row)), ...quotas, pickerQueries: null, storage: evidence?.limitBytes !== null && evidence?.usedBytes !== null && evidence ? { limitBytes: evidence.limitBytes, usedBytes: evidence.usedBytes, reservedBytes: String(reserved), current: evidence.checkedAt <= now && evidence.validUntil > now, checkedAt: evidence.checkedAt, validUntil: evidence.validUntil } : null, blocks: blocks.results });
}
async function readPlatformUsage(db: D1Database, owner: SiteIdentity): Promise<UsageDashboard["platform"]> {
  const inventory = await readStorage("dashboard.material-observation", () => db.prepare("SELECT checked_at AS checkedAt,valid_until AS validUntil FROM material_inventory WHERE owner_id=?").bind(owner.userId).first<{ checkedAt: number; validUntil: number }>());
  const material = inventory ? { ...await getMaterialUsage(db, owner), limitBytes: materialPolicy.maximumStorageBytes, ...inventory } : null;
  return { material, accountR2Remaining: null, d1ProviderRemaining: null, sitesProviderRemaining: null, d1Read: "observed-success", r2Probe: "saved-observation-only" };
}
/** 외부 API·AI·저장 공간 쓰기 검사를 실행하지 않고 기존 원장과 관측 근거만 읽습니다. */
export async function readUsageDashboard(db: D1Database, owner: SiteIdentity, configuration: string | undefined, now: number): Promise<UsageDashboard> {
  siteIdentity.parse(owner);
  const ai = await readCosts(db, owner, configuration, now);
  const google = await readGoogleUsage(db, owner, now);
  const platform = await readPlatformUsage(db, owner);
  const workflows = await readStorage("dashboard.external-workflows", () => db.prepare("SELECT id,kind,state,created_at AS createdAt FROM external_workflows WHERE owner_id=? ORDER BY created_at DESC,id LIMIT 201").bind(owner.userId).all());
  const operations = await readStorage("dashboard.external-operations", () => db.prepare("SELECT id,workflow_id AS workflowId,kind,state,attempt_count AS attempts FROM external_operations WHERE owner_id=? ORDER BY workflow_id,ordinal LIMIT 2001").bind(owner.userId).all());
  requireBound(workflows.results.length, 200, "dashboard.external-workflow-limit"); requireBound(operations.results.length, 2000, "dashboard.external-operation-limit");
  const restoration = await readRestoredExecution(db, owner);
  return usageDashboard.parse({ restoration, asOf: now, source: "saved-ledgers-no-provider-call", ai, google, platform, workflows: workflows.results.map(row => externalWorkflowView.parse(row)), operations: operations.results.map(row => externalOperationView.parse(row)) });
}
