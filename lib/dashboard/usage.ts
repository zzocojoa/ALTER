import { publicSupportCondition } from "./ai-support.ts";
import { restoredExecution } from "../backup/restore-execution.ts";
import { z } from "zod";
import { policy, recordId, timestamp } from "../domain/contracts.ts";
import { pricingVersion } from "../ai/pricing.ts";
import { aiConfiguration } from "../ai/configuration.ts";
import type { AiConfiguration } from "../ai/configuration.ts";
import { monthlyCommittedUnits, monthlyPaidUnits } from "../ai/funding.ts";

const units = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const costWindowView = z.object({ category: z.enum(["ai", "operations"]), limit: units, settled: units, reserved: units, unknown: units, remaining: units, periodStart: timestamp, resetAt: timestamp }).strict();
export const fundingView = z.object({ checkedAt: timestamp, validUntil: timestamp, current: z.boolean(), mode: z.enum(["prepaid", "postpaid"]), source: z.string().url(), creditSnapshotUnits: units, paidKrwUnits: units, committedKrwUnits: units, pendingPayment: z.object({ paidUsdMicros: units, reservedKrwUnits: units, paidAt: timestamp, status: z.literal("pending") }).strict().nullable(), automaticRecharge: z.literal(false), probeLimitUsdMicros: units.nullable(), probeCreditSnapshotUsdMicros: units.nullable(), liveProviderBalance: z.null() }).strict();
export type FundingView = Readonly<z.infer<typeof fundingView>>;
export const googleUsageRow = z.object({ projectId: z.string(), method: z.string(), reservations: units, sent: units, succeeded: units, failed: units, unknown: units, lastSentAt: timestamp.nullable() }).strict();
export const googleLimitView = z.object({ projectId: z.string(), policyVersion: units, api: z.string(), metric: z.string(), unit: z.string(), scope: z.enum(["project", "user"]), appLimit: units, providerLimit: units, appCharged: units.nullable(), consoleUpper: units, current: z.boolean(), checkedAt: timestamp, validUntil: timestamp, windowStart: timestamp, windowEnd: timestamp, source: z.string().url() }).strict();
export const pickerLimitView = z.object({ projectId: z.string(), projectSessionsPerMinute: units, userSessionsPerMinute: units, queriesPerMinutePerUser: units, projectCharged: units, userCharged: units.nullable(), checkedAt: timestamp, validUntil: timestamp, current: z.boolean(), source: z.string().url() }).strict();
export const externalOperationView = z.object({ id: recordId, workflowId: recordId, kind: z.string(), state: z.enum(["pending", "running", "received", "confirmed", "failed", "unknown", "conflict"]), attempts: units }).strict();
export const externalWorkflowView = z.object({ id: recordId, kind: z.string(), state: z.enum(["pending", "running", "partial", "confirmed", "failed", "unknown", "conflict"]), createdAt: timestamp }).strict();
const storageView = z.object({ limitBytes: z.string(), usedBytes: z.string(), reservedBytes: z.string(), current: z.boolean(), checkedAt: timestamp, validUntil: timestamp }).strict();
export const usageDashboard = z.object({
  restoration: restoredExecution.nullable(), asOf: timestamp, source: z.literal("saved-ledgers-no-provider-call"),
  ai: z.object({ support:z.array(publicSupportCondition).max(6), model: z.literal(policy.model), configuration: z.enum(["configured", "missing", "invalid", "owner-mismatch"]), windows: z.array(costWindowView).max(2), pricing: pricingVersion.nullable(), pricingHistory: z.array(pricingVersion).max(100), funding: fundingView.nullable(), probeCommittedUsdMicros: units, liveProviderBilling: z.null() }).strict(),
  google: z.object({ connection: z.object({ email: z.string(), state: z.string(), refreshExpiresAt: timestamp.nullable(), filesAllowed: z.boolean(), calendarAllowed: z.boolean(), providerRevocation: z.string() }).strict().nullable(), methods: z.array(googleUsageRow).max(250), limits: z.array(googleLimitView).max(300), pickerQueries: z.null(), pickerLimits: z.array(pickerLimitView).max(5), storage: storageView.nullable(), blocks: z.array(z.object({ api: z.string(), reason: z.string(), until: timestamp.nullable() }).strict()).max(100) }).strict(),
  platform: z.object({ material: z.object({ limitBytes: units, occupiedBytes: units, reservedBytes: units, untrackedBytes: units, activeTransfers: units, blocked: z.boolean(), checkedAt: timestamp, validUntil: timestamp }).strict().nullable(), accountR2Remaining: z.null(), d1ProviderRemaining: z.null(), sitesProviderRemaining: z.null(), d1Read: z.literal("observed-success"), r2Probe: z.literal("saved-observation-only") }).strict(),
  workflows: z.array(externalWorkflowView).max(200), operations: z.array(externalOperationView).max(2000)
}).strict();
export type UsageDashboard = Readonly<z.infer<typeof usageDashboard>>;

/** 자격 정보와 계정 지문을 제외한 결제 관측값만 화면에 보냅니다. */
export function publicFunding(configuration: AiConfiguration, now: number): FundingView {
  const value = configuration.funding; const pending = value.prepaidProbe?.pendingPayment;
  return fundingView.parse({ checkedAt: value.checkedAt, validUntil: value.validUntil, current: value.checkedAt <= now && value.validUntil > now, mode: value.billingMode, source: value.source, creditSnapshotUnits: value.creditAvailableUnits, paidKrwUnits: monthlyPaidUnits(value, now), committedKrwUnits: monthlyCommittedUnits(value, now), pendingPayment: pending ? { paidUsdMicros: pending.paidUsdMicros, reservedKrwUnits: pending.reservedKrwUnits, paidAt: pending.paidAt, status: "pending" } : null, automaticRecharge: value.automaticRecharge, probeLimitUsdMicros: value.prepaidProbe?.limitUsdMicros ?? null, probeCreditSnapshotUsdMicros: value.prepaidProbe?.creditAvailableUsdMicros ?? null, liveProviderBalance: null });
}
export type DisplayConfiguration = Readonly<{ state: UsageDashboard["ai"]["configuration"]; value: AiConfiguration | null }>;
/** 누락·손상·다른 소유자 설정을 명시적으로 구분하며 오류에 원문 설정을 넣지 않습니다. */
export function displayConfiguration(raw: string | undefined, ownerId: string): DisplayConfiguration {
  if (!raw) return { state: "missing", value: null };
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch (error: unknown) { if (!(error instanceof SyntaxError)) throw error; return { state: "invalid", value: null }; }
  const result = aiConfiguration.safeParse(parsed);
  if (!result.success) return { state: "invalid", value: null };
  if (result.data.funding.ownerId !== ownerId) return { state: "owner-mismatch", value: null };
  if (result.data.funding.pricingVersionId !== result.data.pricing.id) return { state: "invalid", value: null };
  return { state: "configured", value: result.data };
}
