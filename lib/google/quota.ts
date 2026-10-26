import { z } from "zod";
import { contentHash, timestamp, version } from "../domain/contracts.ts";
import { googleApis, googleEvidenceIsCurrent, googleProjectId, requireGoogleProject } from "./project.ts";
import type { GoogleProjectEvidence } from "./project.ts";
import { googleFailure } from "./errors.ts";
import { googleMethodPolicies } from "./permissions.ts";
import type { GoogleMethod, GoogleMethodPolicy } from "./permissions.ts";

const positiveUnits = z.number().int().positive().max(1_000_000_000_000);
const units = z.number().int().nonnegative().max(1_000_000_000_000);
const officialSource = z.string().url().refine(value => { const url = new URL(value); return url.protocol === "https:" && url.hostname === "developers.google.com" && !url.username && !url.password; });
const quotaWindow = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("sliding"), durationMs: z.number().int().min(60_000).max(86_400_000), providerReset: z.literal("rolling") }).strict(),
  z.object({ kind: z.literal("fixed"), periodStart: timestamp, resetAt: timestamp, providerReset: z.string().min(1).max(100) }).strict(),
]);
export const googleQuotaDimension = z.object({
  metric: z.string().regex(/^[a-z][a-z0-9_.-]{1,99}$/), unit: z.enum(["requests", "quota-units", "bytes", "picker-session"]), scope: z.enum(["project", "user"]),
  category: z.enum(["rate", "free-budget", "egress"]), actions: z.array(z.enum(["read", "write", "create", "browser"])).min(1).max(4),
  providerLimit: positiveUnits, appLimit: positiveUnits, window: quotaWindow,
  consoleUsedUpper: units, consoleObservedAt: timestamp, consoleWindowStart: timestamp, consoleWindowEnd: timestamp,
  observation: z.literal("verified-upper-bound"), source: officialSource,
}).strict();
export type GoogleQuotaDimension = Readonly<z.infer<typeof googleQuotaDimension>>;
const methodCost = z.object({ method: z.string(), costs: z.array(z.object({ metric: z.string(), scope: z.enum(["project", "user"]), units: positiveUnits }).strict()).min(1).max(12), source: officialSource }).strict();
const pickerUsage = z.object({
  accounting: z.literal("browser-sessions-only"), projectSessionsPerMinute: z.number().int().positive().max(10), userSessionsPerMinute: z.number().int().positive().max(10),
  provider: z.object({ queriesPerMinutePerUser: positiveUnits, enforcement: z.literal("google"), measuredQueries: z.null(), consoleSource: z.string().url(), checkedAt: timestamp, validUntil: timestamp }).strict(),
}).strict();
export const googleQuotaPolicy = z.object({
  ownerId: z.string().min(1).max(200), projectId: googleProjectId, version, dedicatedProject: z.literal(true), checkedAt: timestamp, validUntil: timestamp,
  apis: z.array(z.object({ api: z.enum(googleApis), dailyFree: z.enum(["limited", "unlimited-verified"]), source: officialSource, dimensions: z.array(googleQuotaDimension).min(2).max(12) }).strict()).min(1).max(5),
  methods: z.array(methodCost).min(1).max(23), pickerUsage: pickerUsage.optional(),
}).strict();
export type GoogleQuotaPolicy = Readonly<z.infer<typeof googleQuotaPolicy>>;
export type GoogleQuotaCharge = Readonly<{ key: string; api: string; metric: string; unit: string; subject: string; weight: number; periodStart: number; periodEnd: number; consoleUsedUpper: number; limit: number; providerReset: string }>;
export type GoogleQuotaPlan = Readonly<{ ownerId: string; projectId: string; policyVersion: number; policyHash: string; checkedAt: number; validUntil: number; method: GoogleMethod; charges: readonly GoogleQuotaCharge[] }>;

/** 콘솔 관측과 로컬 예약을 보수적으로 더하며 미확인 초기화 시각을 추정하지 않습니다. */
export async function prepareGoogleQuota(value: GoogleQuotaPolicy, project: GoogleProjectEvidence, ownerId: string, subject: string, method: GoogleMethod, now: number): Promise<GoogleQuotaPlan> {
  timestamp.parse(now);
  const parsed = googleQuotaPolicy.safeParse(value);
  if (!parsed.success || !Object.hasOwn(googleMethodPolicies, method)) throw googleFailure("google_quota_unverified", "quota-schema");
  const policy: GoogleQuotaPolicy = parsed.data;
  const methodPolicy: GoogleMethodPolicy = googleMethodPolicies[method];
  requireGoogleProject(project, ownerId, policy.projectId, [methodPolicy.api], now);
  if (policy.ownerId !== ownerId || !subject || !googleEvidenceIsCurrent(policy.checkedAt, policy.validUntil, now) || new Set(policy.apis.map(item => item.api)).size !== policy.apis.length || new Set(policy.methods.map(item => item.method)).size !== policy.methods.length) throw googleFailure("google_quota_unverified", "quota-evidence");
  if (method === "picker.open") return preparePickerSessionQuota(policy, project, subject, now);
  const api = policy.apis.find(item => item.api === methodPolicy.api);
  const entry = policy.methods.find(item => item.method === method);
  if (!api || !entry) throw googleFailure("google_quota_unverified", method);
  const dimensions: readonly GoogleQuotaDimension[] = api.dimensions.filter(item => item.actions.includes(methodPolicy.action));
  const keys: readonly string[] = dimensions.map(item => `${item.metric}:${item.scope}`);
  if (new Set(keys).size !== dimensions.length || entry.costs.length !== dimensions.length || new Set(entry.costs.map(item => `${item.metric}:${item.scope}`)).size !== entry.costs.length || !dimensions.some(item => item.scope === "project" && item.category === "rate") || !dimensions.some(item => item.scope === "user" && item.category === "rate") || api.dailyFree === "limited" && !dimensions.some(item => item.category === "free-budget" && item.scope === "project" && item.window.kind === "fixed")) throw googleFailure("google_quota_unverified", "quota-dimensions");
  const charges: GoogleQuotaCharge[] = [];
  for (const dimension of dimensions) {
    const cost = entry.costs.find(item => item.metric === dimension.metric && item.scope === dimension.scope);
    const window = dimension.window;
    const start: number = window.kind === "sliding" ? Math.max(0, now - window.durationMs - 30_000) : window.periodStart;
    const end: number = window.kind === "sliding" ? now + 30_000 : window.resetAt;
    if (!cost || dimension.appLimit > dimension.providerLimit || dimension.consoleObservedAt > now || dimension.consoleObservedAt < policy.checkedAt || dimension.consoleWindowStart > dimension.consoleObservedAt || dimension.consoleWindowEnd < dimension.consoleObservedAt || window.kind === "fixed" && (window.periodStart > now || window.resetAt <= now || window.resetAt - window.periodStart > 90_000_000 || dimension.consoleWindowStart !== start || dimension.consoleWindowEnd !== end)) throw googleFailure("google_quota_unverified", "quota-window-observation");
    if(methodPolicy.api==="drive" && dimension.unit==="quota-units" && cost.units<googleDriveQuotaUnits(method)) throw googleFailure("google_quota_unverified","method-cost-understated");
    if (dimension.consoleUsedUpper + cost.units > dimension.appLimit) throw googleFailure("google_quota_exhausted", method);
    charges.push({ key: await contentHash({ api: api.api, metric: dimension.metric, unit: dimension.unit, scope: dimension.scope }), api: api.api, metric: dimension.metric, unit: dimension.unit, subject: dimension.scope === "project" ? "project" : subject, weight: cost.units, periodStart: start, periodEnd: end, consoleUsedUpper: dimension.consoleUsedUpper, limit: dimension.appLimit, providerReset: window.providerReset });
  }
  return { ownerId, projectId: policy.projectId, policyVersion: policy.version, policyHash: await contentHash(policy), checkedAt: policy.checkedAt, validUntil: Math.min(policy.validUntil, ...charges.map(item => item.periodEnd)), method, charges };
}

/** Picker 내부 조회 수는 SDK가 공개하지 않으므로 서버 발급 세션과 Google 쿼리 한도를 분리합니다. */
async function preparePickerSessionQuota(policy: GoogleQuotaPolicy, project: GoogleProjectEvidence, subject: string, now: number): Promise<GoogleQuotaPlan> {
  const usage = policy.pickerUsage;
  if (!usage || project.billingAccountLinked !== false || policy.apis.some(api => api.api === "picker") || policy.methods.some(entry => entry.method === "picker.open")) throw googleFailure("google_quota_unverified", "picker-session-policy");
  const source: URL = new URL(usage.provider.consoleSource);
  if (source.protocol !== "https:" || source.hostname !== "console.cloud.google.com" || source.username || source.password || source.pathname !== "/apis/api/picker.googleapis.com/quotas" || source.searchParams.get("project") !== policy.projectId || !googleEvidenceIsCurrent(usage.provider.checkedAt, usage.provider.validUntil, now)) throw googleFailure("google_quota_unverified", "picker-provider-evidence");
  const scopes = ["project", "user"] as const;
  const charges: readonly GoogleQuotaCharge[] = await Promise.all(scopes.map(async (scope): Promise<GoogleQuotaCharge> => ({
    key: await contentHash({ api: "picker", metric: "browser-open-minute", unit: "picker-session", scope }), api: "picker", metric: "browser-open-minute", unit: "picker-session", subject: scope === "project" ? "project" : subject,
    weight: 1, periodStart: Math.max(0, now - 120_000), periodEnd: now + 30_000, consoleUsedUpper: 0, limit: scope === "project" ? usage.projectSessionsPerMinute : usage.userSessionsPerMinute, providerReset: "application-session-rolling",
  })));
  return { ownerId: policy.ownerId, projectId: policy.projectId, policyVersion: policy.version, policyHash: await contentHash(policy), checkedAt: policy.checkedAt, validUntil: Math.min(policy.validUntil, usage.provider.validUntil, now + 30_000), method: "picker.open", charges };
}

/** 버전을 올려도 같은 측정 차원과 단위는 유지해 기존 예약을 새 한도에서도 집계합니다. */
export function requireGoogleQuotaPolicySuccessor(previous: GoogleQuotaPolicy, next: GoogleQuotaPolicy): void {
  if (previous.ownerId !== next.ownerId || previous.projectId !== next.projectId || next.version <= previous.version) throw googleFailure("google_quota_unverified", "quota-policy-version");
  if (previous.pickerUsage && !next.pickerUsage) throw googleFailure("google_quota_unverified", "picker-session-policy-removal");
  for (const api of previous.apis) for (const dimension of api.dimensions) {
    const replacement = next.apis.find(item => item.api === api.api)?.dimensions.find(item => item.metric === dimension.metric && item.scope === dimension.scope);
    if (!replacement || replacement.unit !== dimension.unit || replacement.category !== dimension.category || dimension.actions.some(action => !replacement.actions.includes(action))) throw googleFailure("google_quota_unverified", "quota-policy-metric-change");
  }
}

/** 수신량의 최댓값보다 적게 예약해 무료 egress 한도를 우회하지 못하게 합니다. */
export function requireGoogleResponseBudget(plan:GoogleQuotaPlan,maximumBytes:number):void {
  if(!Number.isSafeInteger(maximumBytes) || maximumBytes<65_536) throw googleFailure("google_quota_unverified","response-bound");
  if(plan.charges.some(charge=>charge.unit==="bytes" && charge.weight<maximumBytes)) throw googleFailure("google_quota_unverified","response-reservation-too-small");
}

/** Drive 공식 메서드 비용의 최소값이며 설정이 더 크게 예약하는 것은 허용합니다. */
export function googleDriveQuotaUnits(method:GoogleMethod):number {
  if(!method.startsWith("drive.")) throw googleFailure("google_quota_unverified","drive-method-required");
  switch(method){case "drive.files.list":return 100;case "drive.files.update":return 50;case "drive.files.export":case "drive.files.get-media":return 200;default:return 5;}
}

/** 요청의 실제 수신 상한을 예약하되 정책 상한을 넘기거나 기존 원장의 사용량을 환급하지 않습니다. */
export function boundGoogleResponseQuota(plan:GoogleQuotaPlan,maximumBytes:number):GoogleQuotaPlan {
  requireGoogleResponseBudget(plan,maximumBytes);
  return {...plan,charges:plan.charges.map(charge=>charge.unit==="bytes"?{...charge,weight:maximumBytes}:charge)};
}
