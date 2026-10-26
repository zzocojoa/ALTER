import { describe, expect, it } from "vitest";
import { assembleGoogleApiConfiguration, requireGoogleApiConfiguration } from "../../lib/google/api-settings.ts";

describe("Sites Google 설정 조각", () => {
  const manifest: string = JSON.stringify({ format: "json-chunks-v1", parts: 4 });
  it("명시된 조각을 순서대로 합치고 누락·초과·잘못된 형식을 거부한다", () => {
    expect(assembleGoogleApiConfiguration(manifest, ["{", '"a"', ":1", "}"])).toBe('{"a":1}');
    for (const parts of [["{", '"a"', ":1", undefined], ["{", '"a"', ":1"], ["a".repeat(4501), "b", "c", "d"]]) expect(() => assembleGoogleApiConfiguration(manifest, parts)).toThrow();
    for (const invalid of [undefined, "invalid", "{}", '{"format":"json-chunks-v1","parts":3}']) expect(() => assembleGoogleApiConfiguration(invalid, ["a", "b", "c", "d"])).toThrow();
    expect(() => requireGoogleApiConfiguration(assembleGoogleApiConfiguration(manifest, ["{", '"a"', ":1", "}"]))).toThrow();
  });
});
