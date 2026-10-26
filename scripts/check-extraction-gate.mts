import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "vite";
import { Miniflare } from "miniflare";

const output: string = path.resolve(".sites-runtime/extraction-gate");
await build({ configFile: false, logLevel: "warn", plugins: [{ name: "extraction-test-wasm", enforce: "pre", resolveId(source: string) { if (source.endsWith(".wasm")) return { id: `./${path.basename(source)}`, external: true }; return null; } }], ssr: { noExternal: true, external: ["node:crypto", "node:stream", "node:stream/promises", "node:zlib"], target: "webworker" }, build: { ssr: "tests/fixtures/extraction-worker.ts", target: "es2022", outDir: output, emptyOutDir: true, rollupOptions: { output: { entryFileNames: "worker.mjs" } } } });
await copyFile("lib/materials/pdf-wasm/validator.wasm", path.join(output, "validator.wasm"));
await copyFile("lib/materials/jpeg-wasm/decoder.wasm", path.join(output, "decoder.wasm"));
const runtime: Miniflare = new Miniflare({ modules: true, modulesRules: [{ type: "CompiledWasm", include: ["**/*.wasm"], fallthrough: true }], scriptPath: path.join(output, "worker.mjs"), compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"], r2Buckets: ["BUCKET"], d1Databases: ["DB"], d1Persist: false, r2Persist: false, cf: false });
const results: Readonly<{ fault: string; status: number; result: unknown }>[] = [];
try {
  const db = await runtime.getD1Database("DB");
  const journal: Readonly<{ entries: readonly Readonly<{ tag: string }>[] }> = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
  for (const entry of journal.entries) for (const statement of (await readFile(`drizzle/${entry.tag}.sql`, "utf8")).split("--> statement-breakpoint").map((part: string): string => part.trim()).filter(Boolean)) await db.prepare(statement).run();
  const bytes: Buffer = await readFile("tests/fixtures/pngsuite/basn6a08.png");
  for (const fault of ["none", "other-owner", "forged-id", "unselected", "stale-selection", "missing", "changed-original", "unverified", "dimensions", "bytes", "hash", "coordinate", "mime"]) {
    const response = await runtime.dispatchFetch("https://local.invalid/extraction", { method: "PUT", body: bytes, headers: { "content-type": "image/png", "x-fixture-kind": "image", "x-fixture-filename": "page.png", "x-fixture-bytes": String(bytes.length), "x-fixture-sha256": createHash("sha256").update(bytes).digest("hex"), "x-extraction-fault": fault } });
    const result: unknown = await response.json();
    if (fault === "none") { assert.equal(response.status, 200, JSON.stringify(result)); assert.deepEqual(result, { accepted: true, imageBytes: bytes.length, selectedPages: [1], revision: 1, idempotent: true }); }
    else { assert.ok(response.status >= 400 && response.status < 500, JSON.stringify({ fault, status: response.status, result })); assert.equal((result as { accepted: boolean }).accepted, false); }
    results.push({ fault, status: response.status, result });
  }
  await writeFile(".taskmaster/reports/task-6-gate-local.json", JSON.stringify({ status: "passed", environment: "local-workerd-d1-r2", tests: results.length, externalAiCalls: 0, results }, null, 2) + "\n");
  console.log(JSON.stringify({ status: "passed", tests: results.length, externalAiCalls: 0, results }));
} finally { await runtime.dispose(); }
