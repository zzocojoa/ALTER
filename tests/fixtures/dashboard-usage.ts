import type { UsageDashboard } from "../../lib/dashboard/usage";
import { publicFunding } from "../../lib/dashboard/usage";
import { fixtureFunding, fixturePrepaidProbe } from "./ai-funding";
import { fixturePricing } from "./ai-pricing";
import { recordId } from "../../lib/domain/contracts";
import { seoulMonthWindow } from "../../db/repositories/usage";

export function fixtureUsageDashboard(now: number): UsageDashboard {
  const config = { ...fixturePrepaidProbe(fixtureFunding("usage-owner", fixturePricing().id, now), fixturePricing()), support: [] };
  const id = recordId.parse("00000000-0000-4000-a000-000000000017");
  return { restoration: null, asOf: now, source: "saved-ledgers-no-provider-call", ai: { model: "gpt-6-luna", configuration: "configured", windows: [{ category: "ai", limit: 7_000_000_000, settled: 1_000_000, reserved: 500_000, unknown: 200_000, remaining: 6_998_500_000, ...seoulMonthWindow(now) }], pricing: config.pricing, pricingHistory: [config.pricing], funding: publicFunding(config, now), probeCommittedUsdMicros: 41_730, liveProviderBilling: null }, google: { connection: { email: "fixture@example.test", state: "reconsent", refreshExpiresAt: null, filesAllowed: false, calendarAllowed: false, providerRevocation: "none" }, methods: [{ projectId: "fixture", method: "picker.open", reservations: 3, sent: 3, succeeded: 0, failed: 0, unknown: 3, lastSentAt: now }], limits: [], pickerQueries: null, pickerLimits: [], storage: null, blocks: [] }, platform: { material: null, accountR2Remaining: null, d1ProviderRemaining: null, sitesProviderRemaining: null, d1Read: "observed-success", r2Probe: "saved-observation-only" }, workflows: [{ id, kind: "weekly-report", state: "partial", createdAt: now }], operations: [{ id, workflowId: id, kind: "docs-report", state: "unknown", attempts: 2 }] };
}
