import { describe, expect, it } from "vitest";
import { googleConnectionCanUseData, googleConnectionOutcome } from "../../lib/google/view.ts";
import type { GoogleConnectionView } from "../../lib/google/view.ts";

const active: NonNullable<GoogleConnectionView["connection"]> = { connectionId: "fixture", generation: 1, email: "fixture@example.test", state: "active", filesAllowed: true, calendarAllowed: true, refreshExpiresAt: 1, providerRevocation: "none" };
describe("Google 현재 연결 상태 안내", () => {
  it("해제·갱신·재동의 후 오래된 성공 URL을 현재 연결 성공으로 표시하지 않는다", () => {
    expect(googleConnectionOutcome("connected", active)).not.toBeNull();
    for (const state of ["disconnected", "disconnecting", "reconsent", "refresh-unknown", "refreshing"] as const) {
      const connection = { ...active, state };
      expect(googleConnectionOutcome("connected", connection)).toBeNull();
      expect(googleConnectionCanUseData(connection)).toBe(false);
    }
    expect(googleConnectionOutcome("connected", null)).toBeNull();
    expect(googleConnectionOutcome("partial", { ...active, state: "partial" })).not.toBeNull();
    expect(googleConnectionCanUseData({ ...active, state: "partial" })).toBe(true);
  });
});
