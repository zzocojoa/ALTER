import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "vite";
import { Miniflare } from "miniflare";
import type { JpegContentProof } from "../lib/materials/jpeg-content.ts";
import { paddedJpeg } from "../tests/fixtures/jpeg-bytes.ts";
import { indexedJpeg } from "../tests/fixtures/jpeg-mpf.ts";
import manifest from "../tests/fixtures/jpeg/manifest.json" with { type: "json" };

type ProbeResult = Readonly<{ name: string; bytes: number; declaredBytes: number; status: number; elapsedMs: number; proof: unknown }>;
const output: string = path.resolve(".sites-runtime/material-jpeg-check");
await build({ configFile: false, logLevel: "warn", plugins: [{ name: "jpeg-test-wasm", enforce: "pre", resolveId(source: string) { if (source.endsWith("decoder.wasm")) return { id: "./decoder.wasm", external: true }; return null; } }], ssr: { noExternal: true, external: ["node:crypto"], target: "webworker" }, build: { ssr: "tests/fixtures/material-jpeg-worker.ts", target: "es2022", outDir: output, emptyOutDir: true, rollupOptions: { output: { entryFileNames: "worker.mjs" } } } });
await copyFile("lib/materials/jpeg-wasm/decoder.wasm", path.join(output, "decoder.wasm"));
const runtime: Miniflare = new Miniflare({ modules: true, modulesRules: [{ type: "CompiledWasm", include: ["**/*.wasm"], fallthrough: true }], scriptPath: path.join(output, "worker.mjs"), compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"], cf: false });
async function inspect(name: string, bytes: Uint8Array, expectedStatus: number, expectedField: string | null, expectedPixels: string | null): Promise<ProbeResult> {
  const start: number = performance.now();
  const sha256: string = createHash("sha256").update(bytes).digest("hex");
  const response = await runtime.dispatchFetch("https://local.invalid/jpeg", { method: "POST", body: bytes, headers: { "x-fixture-bytes": String(bytes.byteLength), "x-fixture-sha256": sha256 } });
  const proof: unknown = await response.json();
  assert.equal(response.status, expectedStatus, JSON.stringify({ name, proof }));
  if (expectedStatus === 200) {
    const content: JpegContentProof = proof as JpegContentProof;
    assert.equal(content.transfer.bytes, bytes.byteLength); assert.equal(content.transfer.sha256, sha256);
    assert.ok(content.transfer.maximumReadBufferBytes <= 65536); assert.ok(content.image.maximumInputWindowBytes <= 65536); assert.ok(content.image.maximumRowBytes <= 262144); assert.ok(content.image.wasmMemoryBytes <= 67108864);
    if (expectedPixels !== null) assert.equal(content.image.scanlineSha256, expectedPixels, name);
  } else if (expectedField !== null) assert.equal((proof as { field: string }).field, expectedField, name);
  return { name, bytes: bytes.byteLength, declaredBytes: bytes.byteLength, status: response.status, elapsedMs: Math.round(performance.now() - start), proof };
}

const results: ProbeResult[] = [];
try {
  for (const fixture of manifest.fixtures) {
    const bytes: Buffer = await readFile(`tests/fixtures/jpeg/${fixture.name}.jpg`);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), fixture.sha256);
    results.push(await inspect(fixture.name, bytes, fixture.expectedStatus, null, fixture.scanlineSha256));
  }
  const gray: Buffer = await readFile("tests/fixtures/jpeg/gray.jpg");
  const pixels: string = manifest.fixtures[0].scanlineSha256 as string;
  for (const delta of [-1, 0]) results.push(await inspect(`8MiB-actual-body-${delta}`, paddedJpeg(gray, 8388608 + delta), 200, null, pixels));
  const rejected = await runtime.dispatchFetch("https://local.invalid/jpeg", { method: "POST", body: gray, headers: { "x-fixture-bytes": "8388609", "x-fixture-sha256": createHash("sha256").update(gray).digest("hex") } });
  const rejection: unknown = await rejected.json();
  assert.equal(rejected.status, 413); assert.deepEqual(rejection, { code: "material_size_exceeded", field: "bytes" });
  results.push({ name: "declared-size-8MiB-plus-one-preflight", bytes: gray.byteLength, declaredBytes: 8388609, status: rejected.status, elapsedMs: 0, proof: rejection });
  results.push(await inspect("missing-eoi", gray.subarray(0, gray.length - 2), 422, null, null));
  results.push(await inspect("premature-eoi", Buffer.concat([gray.subarray(0, gray.length - 60), Buffer.from([255, 217])]), 422, null, null));
  results.push(await inspect("app-segment-truncated", Buffer.from([255,216,255,239,255,255,0]), 422, null, null));
  results.push(await inspect("trailing-jpeg", Buffer.concat([gray,gray]), 422, "jpeg:trailing-bytes", null));
  for (const endian of ["little", "big"] as const) {
    const indexed: Uint8Array = indexedJpeg(gray, gray, endian);
    const result: ProbeResult = await inspect(`mpf-${endian}`, indexed, 200, null, pixels);
    assert.equal((result.proof as JpegContentProof).auxiliary?.scanlineSha256, pixels); results.push(result);
  }
  const indexed: Uint8Array = indexedJpeg(gray, gray, "big");
  const wrongOffset: Uint8Array = indexed.slice(); wrongOffset[87] += 1;
  results.push(await inspect("mpf-wrong-offset", wrongOffset, 422, "jpeg:mpf-noncontiguous-images", null));
  const wrongSize: Uint8Array = indexed.slice(); wrongSize[83] += 1;
  results.push(await inspect("mpf-wrong-size", wrongSize, 422, "jpeg:mpf-image-boundary", null));
  const truncatedAuxiliary: Uint8Array = indexed.slice(0, -2);
  new DataView(truncatedAuxiliary.buffer).setUint32(80, gray.length - 2, false);
  results.push(await inspect("mpf-truncated-auxiliary", truncatedAuxiliary, 422, null, null));
  results.push(await inspect("mpf-undeclared-tail", Buffer.concat([indexed, gray]), 422, "jpeg:mpf-image-boundary", null));
  const report = { checkedAt: new Date().toISOString(), status: "passed", runtime: "local-workerd", tests: results.length, libjpeg: "3.2.0", originalFileAccumulated: false, inputWindowBytes: 65536, maximumWasmBytes: 67108864, maximumCoefficientBytes: 50331648, wholeIsolatePeakMeasured: false, actualSitesContentVerified: false, boundaryScope: "Actual bodies at 8MiB-1 and 8MiB; declared +1 preflight uses a small body to avoid local proxy EPIPE after early rejection. Actual +1 stream overflow is a separate unit test.", results };
  await writeFile(".taskmaster/reports/task-5-jpeg-local.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ status: "passed", tests: results.length, maximumWallMs: Math.max(...results.map((result: ProbeResult): number => result.elapsedMs)), wholeIsolatePeakMeasured: false }));
} finally { await runtime.dispose(); }
