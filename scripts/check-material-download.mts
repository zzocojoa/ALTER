import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "vite";
import { Miniflare } from "miniflare";
import { sizedPdf } from "../tests/fixtures/pdf-bytes.ts";

type SqlRow = (string | number | null)[];
type DownloadDatabase = Awaited<ReturnType<Miniflare["getD1Database"]>>;
type InterruptionEvidence = Readonly<{ bytesBeforeCancellation: number; resumedBytes: number; originalBytes: number; sha256: string; sameObjectVersion: boolean; registrationUnchanged: boolean; duplicateObjects: number; environment: "local-workerd-d1-r2" }>;

/** 다운로드가 등록·예약·출처 연결에 쓰기를 남기지 않았는지 전후 행을 대조합니다. */
async function registrationSnapshot(db: DownloadDatabase, owner: string): Promise<readonly (readonly SqlRow[])[]> {
  const tables: readonly string[] = ["materials", "uploads", "material_transfers", "material_files", "material_inventory", "backup_revisions"];
  return Promise.all(tables.map((table: string): Promise<SqlRow[]> => db.prepare(`SELECT * FROM ${table} WHERE owner_id=? ORDER BY rowid`).bind(owner).raw<SqlRow>()));
}

type Scenario = Readonly<{ name: string; bytes: Uint8Array; fault: string; range: string | null; ifRange: string | null; status: number; expected: Uint8Array | null; contentRange: string | null }>;
const output: string = path.resolve(".sites-runtime/material-download-check");
await build({ configFile: false, logLevel: "warn", plugins: [{ name: "complete-test-wasm", enforce: "pre", resolveId(source: string) { if (source.endsWith(".wasm")) return { id: `./${path.basename(source)}`, external: true }; return null; } }], ssr: { noExternal: true, external: ["node:crypto", "node:stream", "node:stream/promises", "node:zlib"], target: "webworker" }, build: { ssr: "tests/fixtures/material-download-worker.ts", target: "es2022", outDir: output, emptyOutDir: true, rollupOptions: { output: { entryFileNames: "worker.mjs" } } } });
await copyFile("lib/materials/pdf-wasm/validator.wasm", path.join(output, "validator.wasm"));
await copyFile("lib/materials/jpeg-wasm/decoder.wasm", path.join(output, "decoder.wasm"));
const runtime: Miniflare = new Miniflare({ modules: true, modulesRules: [{ type: "CompiledWasm", include: ["**/*.wasm"], fallthrough: true }], scriptPath: path.join(output, "worker.mjs"), compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"], r2Buckets: ["BUCKET"], d1Databases: ["DB"], d1Persist: false, r2Persist: false, cf: false });
let interruption: InterruptionEvidence | null = null;
const results: Readonly<{ name: string; status: number; bytes: number }>[] = [];
try {
  const db = await runtime.getD1Database("DB");
  const journal: { entries: { tag: string }[] } = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
  for (const entry of journal.entries) for (const statement of (await readFile(`drizzle/${entry.tag}.sql`, "utf8")).split("--> statement-breakpoint").map((part: string): string => part.trim()).filter(Boolean)) await db.prepare(statement).run();
  const bucket = await runtime.getR2Bucket("BUCKET");
  await bucket.put("preserved-owner-file", "owner");
  const bytes: Uint8Array = new TextEncoder().encode("0123456789<script>literal</script>");
  const largePdf: Uint8Array = sizedPdf(20971520);
  const base: Scenario = { name: "full", bytes, fault: "none", range: null, ifRange: null, status: 200, expected: bytes, contentRange: null };
  const scenarios: readonly Scenario[] = [base,
    { ...base, name: "stale-if-match", fault: "stale-if-match", status: 412, expected: null },
    { ...base, name: "matching-if-match", fault: "matching-if-match" },
    { ...base, name: "first", range: "bytes=0-9", status: 206, expected: bytes.slice(0, 10), contentRange: `bytes 0-9/${bytes.length}` },
    { ...base, name: "last-open", range: `bytes=${bytes.length - 5}-`, status: 206, expected: bytes.slice(-5), contentRange: `bytes ${bytes.length - 5}-${bytes.length - 1}/${bytes.length}` },
    { ...base, name: "suffix", range: "bytes=-5", status: 206, expected: bytes.slice(-5), contentRange: `bytes ${bytes.length - 5}-${bytes.length - 1}/${bytes.length}` },
    { ...base, name: "oversized-end", range: "bytes=0-999", status: 206, contentRange: `bytes 0-${bytes.length - 1}/${bytes.length}` },
    { ...base, name: "matching-if-range", range: "bytes=0-0", ifRange: "matching", status: 206, expected: bytes.slice(0, 1), contentRange: `bytes 0-0/${bytes.length}` },
    { ...base, name: "changed-if-range", range: "bytes=0-0", ifRange: "changed" },
    ...["bytes=999-", "bytes=-0", "bytes=9-2", "bytes=0-1,4-5", "not-a-range"].map((range): Scenario => ({ ...base, name: range, range, status: 416, expected: new Uint8Array(), contentRange: `bytes */${bytes.length}` })),
    { ...base, name: "head-ignores-range", fault: "head", range: "bytes=0-0", expected: new Uint8Array() },
    ...["missing", "changed-version", "foreign-owner", "unregistered", "raw-key"].map((fault): Scenario => ({ ...base, name: fault, fault, status: ["missing", "changed-version"].includes(fault) ? 409 : fault === "raw-key" ? 400 : 404, expected: null })),
    { ...base, name: "20MiB-full-original", bytes: largePdf, expected: largePdf },
    { ...base, name: "20MiB-pdf-range", bytes: largePdf, range: "bytes=-65536", status: 206, expected: largePdf.slice(-65536), contentRange: `bytes ${largePdf.length - 65536}-${largePdf.length - 1}/${largePdf.length}` },
  ];
  for (const scenario of scenarios) {
    const isPdf: boolean = scenario.bytes === largePdf;
    const headers: Record<string, string> = { "accept-encoding": "identity", "content-type": isPdf ? "application/pdf" : "text/plain", "content-length": String(scenario.bytes.length), "x-fixture-kind": isPdf ? "pdf" : "text", "x-fixture-filename": isPdf ? "fixture.pdf" : "fixture.txt", "x-fixture-bytes": String(scenario.bytes.length), "x-fixture-sha256": createHash("sha256").update(scenario.bytes).digest("hex"), "x-fixture-fault": scenario.fault };
    if (scenario.range !== null) headers["x-fixture-range"] = scenario.range;
    if (scenario.ifRange !== null) headers["x-fixture-if-range"] = scenario.ifRange;
    let response = await runtime.dispatchFetch("https://local.invalid/download", { method: "PUT", body: scenario.bytes, headers });
    const key: string | null = response.headers.get("x-fixture-key");
    if (scenario.fault === "head") {
      await response.arrayBuffer();
      response = await runtime.dispatchFetch("https://local.invalid/download", { method: "HEAD", headers: { "accept-encoding": "identity", "x-fixture-owner": response.headers.get("x-fixture-owner") ?? "", "x-fixture-material": response.headers.get("x-fixture-material") ?? "", range: "bytes=0-0" } });
    }
    let actual: Uint8Array;
    if (scenario.name === "20MiB-full-original") {
      assert.ok(key);
      const owner: string | null = response.headers.get("x-fixture-owner");
      const material: string | null = response.headers.get("x-fixture-material");
      const etag: string | null = response.headers.get("etag");
      assert.ok(owner); assert.ok(material); assert.ok(etag); assert.ok(response.body);
      const beforeRows = await registrationSnapshot(db, owner);
      const beforeObject = await bucket.head(key);
      const beforeKeys: readonly string[] = (await bucket.list()).objects.map((object): string => object.key);
      assert.ok(beforeObject);
      const reader = response.body.getReader();
      const first = await reader.read();
      assert.equal(first.done, false); assert.ok(first.value);
      const prefix: Uint8Array = new Uint8Array(first.value);
      assert.ok(prefix.length > 0 && prefix.length < scenario.bytes.length);
      await reader.cancel("검증: 일부 원본 수신 후 다운로드 취소");
      reader.releaseLock();
      const resumeHeaders: Record<string, string> = { "accept-encoding": "identity", "x-fixture-owner": owner, "x-fixture-material": material, "if-range": etag, range: `bytes=${prefix.length}-` };
      const resumed = await runtime.dispatchFetch("https://local.invalid/download", { method: "GET", headers: resumeHeaders });
      assert.equal(resumed.status, 206);
      assert.equal(resumed.headers.get("etag"), etag);
      assert.equal(resumed.headers.get("content-range"), `bytes ${prefix.length}-${scenario.bytes.length - 1}/${scenario.bytes.length}`);
      const suffix: Uint8Array = new Uint8Array(await resumed.arrayBuffer());
      actual = new Uint8Array(Buffer.concat([prefix, suffix]));
      const expectedHash: string = createHash("sha256").update(scenario.bytes).digest("hex");
      assert.equal(createHash("sha256").update(actual).digest("hex"), expectedHash);
      const fresh = await runtime.dispatchFetch("https://local.invalid/download", { method: "GET", headers: { "accept-encoding": "identity", "x-fixture-owner": owner, "x-fixture-material": material } });
      assert.equal(fresh.status, 200); assert.equal(fresh.headers.get("etag"), etag);
      assert.equal(createHash("sha256").update(new Uint8Array(await fresh.arrayBuffer())).digest("hex"), expectedHash);
      assert.deepEqual(await registrationSnapshot(db, owner), beforeRows);
      const afterObject = await bucket.head(key);
      assert.ok(afterObject); assert.equal(afterObject.version, beforeObject.version); assert.equal(afterObject.etag, beforeObject.etag); assert.equal(afterObject.size, beforeObject.size);
      assert.deepEqual((await bucket.list()).objects.map((object): string => object.key), beforeKeys);
      interruption = { bytesBeforeCancellation: prefix.length, resumedBytes: suffix.length, originalBytes: actual.length, sha256: expectedHash, sameObjectVersion: true, registrationUnchanged: true, duplicateObjects: 0, environment: "local-workerd-d1-r2" };
    } else actual = new Uint8Array(await response.arrayBuffer());
    assert.equal(response.status, scenario.status, `${scenario.name}: ${new TextDecoder().decode(actual.slice(0, 1000))}`);
    if (scenario.expected !== null) {
      assert.deepEqual(actual, new Uint8Array(scenario.expected), scenario.name);
      assert.equal(response.headers.get("content-range"), scenario.contentRange, scenario.name);
      assert.match(response.headers.get("cache-control") ?? "", /private, no-store/);
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.equal(response.headers.get("accept-ranges"), "bytes");
      assert.ok(response.headers.get("etag"));
      assert.equal(Number(response.headers.get("content-length")), scenario.fault === "head" ? bytes.length : actual.length, JSON.stringify({ scenario: scenario.name, headers: Object.fromEntries(response.headers) }));
    }
    assert.ok(key); await bucket.delete(key);
    assert.deepEqual((await bucket.list()).objects.map((object): string => object.key), ["preserved-owner-file"]);
    results.push({ name: scenario.name, status: response.status, bytes: actual.length });
  }
  assert.ok(interruption);
  await writeFile(".taskmaster/reports/task-5-download-local.json", JSON.stringify({ status: "passed", environment: "local-workerd-d1-r2", tests: results.length, interruption, productionWholeOriginalAccumulated: false, fixturesBufferedInTestRunnerOnly: true, unrelatedObjectPreserved: true, results }, null, 2) + "\n");
  console.log(JSON.stringify({ status: "passed", tests: results.length, interruption, results }));
} finally { await runtime.dispose(); }
