import { describe, expect, it } from "vitest";
import { parseMaterialRange } from "../../lib/materials/range";

describe("단일 바이트 범위", (): void => {
  it.each([
    [null, { kind: "full" }], ["bytes=0-0", { kind: "range", range: { offset: 0, length: 1 } }],
    ["bytes=2-5", { kind: "range", range: { offset: 2, length: 4 } }], ["bytes=8-", { kind: "range", range: { offset: 8, length: 2 } }],
    ["bytes=-3", { kind: "range", range: { offset: 7, length: 3 } }], ["bytes=-30", { kind: "range", range: { offset: 0, length: 10 } }],
    ["bytes=8-99", { kind: "range", range: { offset: 8, length: 2 } }],
  ])("%s를 실제 객체 크기에 맞춘다", (value, result): void => { expect(parseMaterialRange(value as string | null, 10)).toEqual(result); });
  it.each(["bytes=10-", "bytes=9-8", "bytes=-0", "bytes=-", "bytes=", "bytes=1-2,4-5", "items=1-2", "bytes=1.5-2", "bytes=9007199254740992-", "bytes=0-9007199254740992"])("잘못되거나 지원하지 않는 %s를 거부한다", (value): void => { expect(parseMaterialRange(value, 10)).toEqual({ kind: "unsatisfiable" }); });
});
