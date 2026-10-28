import type { GoogleConnectionView } from "../../lib/google/view";

export function googleConnectionFixture(state: NonNullable<GoogleConnectionView["connection"]>["state"] | null, configured: boolean): GoogleConnectionView {
  return { configured, configurationIssue: configured ? null : "Google 연결 준비가 필요해요.", connection: state === null ? null : { connectionId: "00000000-0000-4000-8000-000000002001", generation: 4, email: "fixture-owner@example.test", state, filesAllowed: state !== "partial", calendarAllowed: true, refreshExpiresAt: Date.parse("2026-11-01T00:00:00Z"), providerRevocation: state === "disconnected" ? "unknown" : "none" } };
}
