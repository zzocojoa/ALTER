import { afterEach, describe, expect, it, vi } from "vitest";
import { openGooglePicker } from "../../lib/google/picker-browser.ts";
import type { GooglePickerBuilder, GooglePickerInstance, GooglePickerSdk } from "../../lib/google/picker-browser.ts";
import { googlePickerCredentials } from "../../lib/google/picker.ts";

const now: number = Date.parse("2026-10-25T00:00:00Z");
const credentials = googlePickerCredentials.parse({ leaseId: "00000000-0000-4000-a000-000000001401", connectionId: "00000000-0000-4000-a000-000000001400", generation: 1, projectNumber: "123456789", origin: "https://alter.example.test", apiKey: "fixture-api-key-not-real", accessToken: "fixture-access-not-real", tokenExpiresAt: now + 3_600_000, leaseExpiresAt: now + 60_000 });
function fixtureSdk(): Readonly<{ sdk: GooglePickerSdk; emit: (value: unknown) => void; disposed: () => number; values: () => readonly string[] }> {
  let callback: (value: unknown) => void = () => { throw new Error("Picker callback 미등록"); };
  let disposed: number = 0; const values: string[] = [];
  class FakeBuilder implements GooglePickerBuilder {
    setOAuthToken(value: string): GooglePickerBuilder { values.push(value); return this; }
    setDeveloperKey(value: string): GooglePickerBuilder { values.push(value); return this; }
    setAppId(value: string): GooglePickerBuilder { values.push(value); return this; }
    setOrigin(value: string): GooglePickerBuilder { values.push(value); return this; }
    setCallback(value: (data: unknown) => void): GooglePickerBuilder { callback = value; return this; }
    setSelectableMimeTypes(value: string): GooglePickerBuilder { values.push(value); return this; }
    setMaxItems(value: number): GooglePickerBuilder { values.push(String(value)); return this; }
    setLocale(value: string): GooglePickerBuilder { values.push(value); return this; }
    addView(value: string): GooglePickerBuilder { values.push(value); return this; }
    build(): GooglePickerInstance { return { setVisible: () => {}, dispose: () => { disposed += 1; } }; }
  }
  return { sdk: { PickerBuilder: FakeBuilder, ViewId: { DOCS: "docs" } }, emit: value => callback(value), disposed: () => disposed, values: () => values };
}
afterEach(() => vi.useRealTimers());
describe("Picker 메모리 수명과 결과 전달", () => {
  it("선택된 ID만 전달하고 토큰·문서 본문을 결과에서 제거한다", async () => {
    const fixture = fixtureSdk(); const controller = new AbortController();
    const outcome = openGooglePicker(fixture.sdk, credentials, "reference", credentials.origin, controller.signal, () => now);
    fixture.emit({ action: "loaded" }); fixture.emit({ action: "picked", docs: [{ id: "selected-doc", name: "불신 입력", accessToken: "secret" }] });
    const result = await outcome;
    expect(result).toEqual({ kind: "selected", selection: { leaseId: credentials.leaseId, connectionId: credentials.connectionId, generation: 1, fileId: "selected-doc", role: "reference" } });
    expect(fixture.disposed()).toBe(1); expect(JSON.stringify(result)).not.toMatch(/accessToken|secret|불신/);
    fixture.emit({ action: "cancel" }); expect(fixture.disposed()).toBe(1);
    expect(fixture.values()).toContain(credentials.origin);
    expect(fixture.values()).toContain("application/vnd.google-apps.document,application/pdf,image/png,image/jpeg");
  });
  it("취소·잘못된 선택 결과·중단 시 Picker를 폐기한다", async () => {
    for (const data of [{ action: "cancel" }, { action: "picked", docs: [{ id: "https://evil.test" }] }, { action: "picked", docs: [{ id: "a" }, { id: "b" }] }]) {
      const fixture = fixtureSdk(); const result = openGooglePicker(fixture.sdk, credentials, "docs-target", credentials.origin, new AbortController().signal, () => now);
      fixture.emit(data);
      if (data.action === "cancel") await expect(result).resolves.toEqual({ kind: "canceled" }); else await expect(result).rejects.toThrow();
      expect(fixture.disposed()).toBe(1);
    }
    const fixture = fixtureSdk(); const controller = new AbortController(); const result = openGooglePicker(fixture.sdk, credentials, "reference", credentials.origin, controller.signal, () => now); controller.abort();
    await expect(result).rejects.toThrow("중단"); expect(fixture.disposed()).toBe(1);
  });
  it("만료 타이머와 origin 불일치가 선택을 막는다", async () => {
    vi.useFakeTimers(); const fixture = fixtureSdk();
    await expect(openGooglePicker(fixture.sdk, credentials, "reference", "https://evil.test", new AbortController().signal, () => now)).rejects.toThrow();
    const result = openGooglePicker(fixture.sdk, credentials, "reference", credentials.origin, new AbortController().signal, () => now);
    const assertion = expect(result).rejects.toThrow("만료"); await vi.advanceTimersByTimeAsync(60_000); await assertion; expect(fixture.disposed()).toBe(1);
  });
});
