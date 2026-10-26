import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { build } from "vite";
import { Miniflare } from "miniflare";
import { materialPolicy } from "../lib/materials/policy.ts";
import type { PngContentProof } from "../lib/materials/png-content.ts";
import { pngChunk, pngHeader, pngImage, pngFile } from "../tests/fixtures/png-bytes.ts";
import type { PngFixtureHeader } from "../tests/fixtures/png-bytes.ts";

type Fixture = Readonly<{ file: string; sha256: string; valid: boolean }>;
type PixelOracle = Readonly<{ file: string; scanlineSha256: string }>;
type ProbeResult = Readonly<{ name: string; bytes: number; status: number; elapsedMs: number; proof: unknown }>;
const corpus: Readonly<{ fixtures: readonly Fixture[] }> = JSON.parse(await readFile("tests/fixtures/pngsuite/manifest.json", "utf8"));
const oracle: Readonly<{ fixtures: readonly PixelOracle[] }> = JSON.parse(await readFile("tests/fixtures/pngsuite/pixel-oracle.json", "utf8"));
const output: string = path.resolve(".sites-runtime/material-png-check");
await build({ configFile: false, logLevel: "warn", ssr: { noExternal: true, external: ["node:crypto", "node:stream", "node:stream/promises", "node:zlib"], target: "webworker" }, build: { ssr: "tests/fixtures/material-png-worker.ts", target: "es2022", outDir: output, emptyOutDir: true, rollupOptions: { output: { entryFileNames: "worker.mjs" } } } });
const runtime: Miniflare = new Miniflare({ modules: true, scriptPath: path.join(output, "worker.mjs"), compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"], cf: false });
async function inspect(name: string, bytes: Uint8Array, expectedStatus: number): Promise<ProbeResult> {
  const start: number = performance.now();
  const sha256: string = createHash("sha256").update(bytes).digest("hex");
  // 크기 초과는 본문 전송 전 메타데이터에서 거부되므로 끊긴 소켓에 큰 본문을 쓰지 않습니다.
  const response = await runtime.dispatchFetch("https://local.invalid/png", { method: "POST", body: bytes.byteLength>materialPolicy.types.image.maximumBytes ? new Uint8Array(0) : bytes, headers: { "x-fixture-bytes": String(bytes.byteLength), "x-fixture-sha256": sha256 } });
  const text: string = await response.text().catch((cause: unknown): never => { throw new Error(`PNG 검증 응답 읽기 실패: ${name}, status=${response.status}`, { cause }); });
  assert.equal(response.status, expectedStatus, JSON.stringify({ name, body: text }));
  const proof: unknown = JSON.parse(text);
  if (expectedStatus === 200) {
    const content: PngContentProof = proof as PngContentProof;
    assert.equal(content.transfer.bytes, bytes.byteLength); assert.equal(content.transfer.sha256, sha256);
    assert.ok(content.transfer.maximumReadBufferBytes <= 65536); assert.ok(content.image.maximumRowBytes <= 262144); assert.ok(content.image.maximumInflateChunkBytes <= 65536);
    const expected: PixelOracle | undefined = oracle.fixtures.find((fixture: PixelOracle): boolean => fixture.file === name);
    if (expected !== undefined) assert.equal(content.image.scanlineSha256, expected.scanlineSha256);
  }
  return { name, bytes: bytes.byteLength, status: response.status, elapsedMs: Math.round(performance.now() - start), proof };
}
const results: ProbeResult[] = [];
try {
  for (const fixture of corpus.fixtures) {
    const bytes: Buffer = await readFile(`tests/fixtures/pngsuite/${fixture.file}`);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), fixture.sha256);
    results.push(await inspect(fixture.file, bytes, fixture.valid ? 200 : 422));
  }
  const largeHeader: PngFixtureHeader = { width: 4000, height: 4000, depth: 16, color: 6, interlace: 0 };
  results.push(await inspect("16-million-pixels-128MB-decoded", pngImage(largeHeader, new Uint8Array(4000 * (32000 + 1))), 200));
  results.push(await inspect("maximum-row-256KiB", pngImage({ width: 32768, height: 1, depth: 16, color: 6, interlace: 0 }, new Uint8Array(262145)), 200));
  results.push(await inspect("maximum-scanlines-65536", pngImage({ width: 1, height: 65536, depth: 8, color: 0, interlace: 0 }, new Uint8Array(131072)), 200));
  results.push(await inspect("scanline-limit-exceeded", pngImage({ width: 1, height: 65537, depth: 8, color: 0, interlace: 0 }, new Uint8Array([0,42])), 422));
  const gray: PngFixtureHeader = { width: 1, height: 1, depth: 8, color: 0, interlace: 0 };
  const small: Buffer = pngImage(gray, new Uint8Array([0, 42]));
  const maximumBytes: number = 8388608;
  for (const delta of [-1, 0, 1]) {
    const padded: Buffer = pngFile([pngHeader(gray), pngChunk("teSt", new Uint8Array(maximumBytes + delta - small.byteLength - 12)), pngChunk("IDAT", deflateSync(new Uint8Array([0, 42]))), pngChunk("IEND", new Uint8Array(0))]);
    results.push(await inspect(`8MiB-file-boundary-${delta}`, padded, delta === 1 ? 413 : 200));
  }
  const noisyRows: Buffer = randomBytes(1000 * (8000 + 1));
  for (let row: number = 0; row < 1000; row += 1) noisyRows[row * 8001] = 0;
  results.push(await inspect("8MB-incompressible-pixels", pngImage({ width: 2000, height: 1000, depth: 8, color: 6, interlace: 0 }, noisyRows), 200));
  results.push(await inspect("pixel-limit-exceeded", pngImage({ ...largeHeader, width: 4001 }, new Uint8Array([0])), 422));
  results.push(await inspect("row-limit-exceeded", pngImage({ width: 100000, height: 1, depth: 8, color: 6, interlace: 0 }, new Uint8Array([0])), 422));
  results.push(await inspect("excess-decompressed-data", pngImage(gray, new Uint8Array(1024 * 1024)), 422));
  const compressed: Buffer = deflateSync(new Uint8Array([0,42]));
  results.push(await inspect("trailing-compressed-data", pngFile([pngHeader(gray), pngChunk("IDAT", Buffer.concat([compressed, Buffer.from([1,2,3])])), pngChunk("IEND", new Uint8Array(0))]), 422));
  const evidence = { checkedAt: new Date().toISOString(), status: "passed", runtime: "local-workerd", tests: results.length, results, wholeIsolateMemoryMeasured: false, actualSitesContentVerified: false, hostedWrites: 0, openAiCalls: 0, scope: "PNG actual decompression and reconstructed scanlines, CRC, exact original byte count and SHA-256; application buffers only, not whole-isolate peak" };
  await writeFile(".taskmaster/reports/task-5-png-local.json", JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify({ tests: evidence.tests, status: evidence.status, runtime: evidence.runtime, maximumWallMs: Math.max(...results.map((item: ProbeResult): number => item.elapsedMs)) }));
} finally { await runtime.dispose(); }
