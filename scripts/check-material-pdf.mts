import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { build } from "vite";
import { Miniflare } from "miniflare";
import type { PdfProbeProof } from "../lib/materials/pdf-probe-storage.ts";
import { contentPdf, pageTreePdf, pdfStream, scannedPdf, sizedPdf, textPdf } from "../tests/fixtures/pdf-bytes.ts";
import manifest from "../tests/fixtures/pdf/manifest.json" with { type: "json" };

type ProbeResult = Readonly<{ name: string; bytes: number; status: number; elapsedMs: number; proof: unknown }>;
const output: string = path.resolve(".sites-runtime/material-pdf-check");
await build({ configFile: false, logLevel: "warn", plugins: [{ name: "pdf-test-wasm", enforce: "pre", resolveId(source: string) { if (source.endsWith("validator.wasm")) return { id: "./validator.wasm", external: true }; return null; } }], ssr: { noExternal: true, external: ["node:crypto"], target: "webworker" }, build: { ssr: "tests/fixtures/material-pdf-worker.ts", target: "es2022", outDir: output, emptyOutDir: true, rollupOptions: { output: { entryFileNames: "worker.mjs" } } } });
await copyFile("lib/materials/pdf-wasm/validator.wasm", path.join(output, "validator.wasm"));
const runtime: Miniflare = new Miniflare({ modules: true, modulesRules: [{ type: "CompiledWasm", include: ["**/*.wasm"], fallthrough: true }], scriptPath: path.join(output, "worker.mjs"), compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"], r2Buckets: ["BUCKET"], cf: false });
const results: ProbeResult[] = [];
async function inspect(name: string, bytes: Uint8Array, status: number, pages: number | null): Promise<void> {
  const start: number = performance.now();
  const sha256: string = createHash("sha256").update(bytes).digest("hex");
  const response = await runtime.dispatchFetch("https://local.invalid/pdf", { method: "POST", body: bytes, headers: { "x-fixture-bytes": String(bytes.length), "x-fixture-sha256": sha256 } });
  const proof: unknown = await response.json();
  assert.equal(response.status, status, JSON.stringify({ name, proof }));
  if (pages !== null) { const verified = proof as PdfProbeProof; assert.equal(verified.pdf.pages, pages); assert.equal(verified.transfer.sha256, sha256); assert.equal(verified.transfer.bytes, bytes.length); assert.ok(verified.pdf.maximumRangeBytes <= 65536); assert.ok(verified.pdf.wasmMemoryBytes <= 67108864); assert.equal(verified.cleanup, "passed"); }
  const bucket = await runtime.getR2Bucket("BUCKET");
  assert.deepEqual((await bucket.list()).objects.map((entry) => entry.key), ["preserved-owner-file"]);
  results.push({ name, bytes: bytes.length, status, elapsedMs: Math.round(performance.now() - start), proof });
}
try {
  const bucket = await runtime.getR2Bucket("BUCKET");
  await bucket.put("preserved-owner-file", "owner");
  await inspect("text", textPdf(), 200, 1);
  for (const fixture of manifest.fixtures) await inspect(fixture.name, await readFile(`tests/fixtures/pdf/${fixture.name}.pdf`), 200, fixture.pages);
  await inspect("scanned-jpeg", scannedPdf(await readFile("tests/fixtures/jpeg/gray.jpg"), "/DCTDecode", 17, 19), 200, 1);
  await inspect("pages-500", pageTreePdf(500, 500), 200, 500);
  await inspect("pages-501", pageTreePdf(501, 501), 422, null);
  await inspect("count-forged", pageTreePdf(2, 1), 422, null);
  const compressed: Buffer = deflateSync(Buffer.from("q Q\n"));
  for (const [name, bytes] of [["flate-truncated", compressed.subarray(0, compressed.length - 1)], ["flate-trailing", Buffer.concat([compressed, Buffer.from([0])])], ["flate-adler", Buffer.concat([compressed.subarray(0, compressed.length - 1), Buffer.from([compressed[compressed.length - 1] ^ 1])])]] as const) await inspect(name, contentPdf(pdfStream("/Filter /FlateDecode", bytes, bytes.length)), 422, null);
  await inspect("20MiB-exact-stream", sizedPdf(20971520), 200, 1);
  await writeFile(".taskmaster/reports/task-5-pdf-local.json", JSON.stringify({ checkedAt: new Date().toISOString(), status: "passed", runtime: "local-workerd-r2", tests: results.length, sourceReadsVersionBound: true, originalFileAccumulated: false, maximumWasmBytes: 67108864, wholeIsolatePeakMeasured: false, encodedImagePixelsDecoded: false, unrelatedObjectPreserved: true, results }, null, 2) + "\n");
  console.log(JSON.stringify({ status: "passed", tests: results.length, maximumWallMs: Math.max(...results.map((result) => result.elapsedMs)) }));
} finally { await runtime.dispose(); }
