import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { textProbes, textProbeMetadata, requireTextProbeResult } from "../../lib/materials/text-probe";
import { validateTextContent } from "../../lib/materials/text-content";
import type { MaterialFailure } from "../../lib/materials/policy";
import { pngSource } from "../fixtures/png-bytes";

describe("운영 텍스트 진단 계약", () => {
  it.each(textProbes)("$id 고정 파일을 실제 스트리밍으로 검증한다", async (fixture) => {
    const bytes: Buffer = readFileSync(`public${fixture.url}`);
    const metadata = textProbeMetadata(new Request("https://alter.test/text", { headers: { "x-text-probe": fixture.id, "content-type": "text/plain", "content-length": String(bytes.length) } }));
    const outcome = await Promise.allSettled([validateTextContent(pngSource(bytes, 65535), metadata, new AbortController().signal)]);
    const result = outcome[0];
    if (fixture.status === 200) { if (result.status === "rejected") throw result.reason; expect(() => requireTextProbeResult(fixture, 200, result.value)).not.toThrow(); }
    else { if (result.status === "fulfilled") throw new Error("손상 텍스트가 허용됐습니다."); const failure: MaterialFailure = result.reason as MaterialFailure; expect(() => requireTextProbeResult(fixture, failure.status, { error: failure.code, field: failure.field })).not.toThrow(); }
  });
});
