import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "vite";
import { Miniflare } from "miniflare";
import { pageTreePdf, scannedPdf, textPdf } from "../tests/fixtures/pdf-bytes.ts";
import type { TransferSnapshot } from "../lib/materials/transfer-state.ts";
import type { MaterialRegistration } from "../lib/materials/complete.ts";
import type { MaterialUsage } from "../db/repositories/material-transfers.ts";

type Scenario = Readonly<{ name: string; bytes: Uint8Array; kind: "pdf" | "text" | "image"; mime: string; filename: string; fault: string; status: number; pages: number | null }>;
type CompletionResult = Readonly<{ result: MaterialRegistration; state: TransferSnapshot; usage: MaterialUsage; idempotent: boolean; registered: number; objectKey: string; storedBytes: number }>;
const output: string = path.resolve(".sites-runtime/material-complete-check");
await build({ configFile: false, logLevel: "warn", plugins: [{ name: "complete-test-wasm", enforce: "pre", resolveId(source: string) { if (source.endsWith(".wasm")) return { id: `./${path.basename(source)}`, external: true }; return null; } }], ssr: { noExternal: true, external: ["node:crypto", "node:stream", "node:stream/promises", "node:zlib"], target: "webworker" }, build: { ssr: "tests/fixtures/material-complete-worker.ts", target: "es2022", outDir: output, emptyOutDir: true, rollupOptions: { output: { entryFileNames: "worker.mjs" } } } });
await copyFile("lib/materials/pdf-wasm/validator.wasm", path.join(output, "validator.wasm"));
await copyFile("lib/materials/jpeg-wasm/decoder.wasm", path.join(output, "decoder.wasm"));
const runtime: Miniflare = new Miniflare({ modules: true, modulesRules: [{ type: "CompiledWasm", include: ["**/*.wasm"], fallthrough: true }], scriptPath: path.join(output, "worker.mjs"), compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"], r2Buckets: ["BUCKET"], d1Databases: ["DB"], d1Persist: false, r2Persist: false, cf: false });
const results: Readonly<{ name: string; status: number; state: string; registered: number }>[] = [];
try {
  const db = await runtime.getD1Database("DB");
  const journal: { entries: { tag: string }[] } = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
  for (const entry of journal.entries) for (const statement of (await readFile(`drizzle/${entry.tag}.sql`, "utf8")).split("--> statement-breakpoint").map((part: string): string => part.trim()).filter(Boolean)) await db.prepare(statement).run();
  const bucket = await runtime.getR2Bucket("BUCKET");
  await bucket.put("preserved-owner-file", "owner");
  const base: Scenario = { name: "text-pdf", bytes: textPdf(), kind: "pdf", mime: "application/pdf", filename: "fixture.pdf", fault: "none", status: 200, pages: 1 };
  const jpeg: Uint8Array = await readFile("tests/fixtures/jpeg/gray.jpg");
  const text: Uint8Array = new TextEncoder().encode("텍스트 원본 <script>alert('literal')</script>");
  const malformedUtf8: Uint8Array = new Uint8Array(101).fill(97); malformedUtf8[100] = 255;
  const scenarios: readonly Scenario[] = [base,
    { ...base, name: "concurrent-completion", fault: "concurrent" },
    { ...base, name: "registration-batch-rollback", fault: "inventory-block", status: 503, pages: null },
    { ...base, name: "png", bytes: await readFile("public/diagnostics/png/maximum-row.png"), kind: "image", mime: "image/png", filename: "fixture.png" },
    { ...base, name: "damaged-png", bytes: await readFile("public/diagnostics/png/invalid-crc.png"), kind: "image", mime: "image/png", filename: "fixture.png", status: 422, pages: null },
    { ...base, name: "scanned-pdf", bytes: scannedPdf(jpeg, "/DCTDecode", 17, 19) },
    { ...base, name: "500-pages", bytes: pageTreePdf(500, 500), pages: 500 },
    { ...base, name: "501-pages", bytes: pageTreePdf(501, 501), status: 422, pages: null },
    { ...base, name: "forged-page-count", bytes: pageTreePdf(2, 1), status: 422, pages: null },
    { ...base, name: "damaged-pdf", bytes: new TextEncoder().encode("%PDF-1.7\nnot a complete pdf"), status: 422, pages: null },
    { ...base, name: "jpeg", bytes: jpeg, kind: "image", mime: "image/jpeg", filename: "fixture.jpg" },
    { ...base, name: "text-literal-html", bytes: text, kind: "text", mime: "text/plain", filename: "fixture.txt" },
    { ...base, name: "invalid-utf8-after-prefix", bytes: malformedUtf8, kind: "text", mime: "text/plain", filename: "fixture.txt", status: 422, pages: null },
    { ...base, name: "missing-object", fault: "missing", status: 409, pages: null },
    { ...base, name: "changed-object-version", fault: "changed-version", status: 409, pages: null },
  ];
  for (const scenario of scenarios) {
    const response = await runtime.dispatchFetch("https://local.invalid/complete", { method: "PUT", body: scenario.bytes, headers: { "content-type": scenario.mime, "x-fixture-kind": scenario.kind, "x-fixture-filename": scenario.filename, "x-fixture-bytes": String(scenario.bytes.length), "x-fixture-sha256": createHash("sha256").update(scenario.bytes).digest("hex"), "x-fixture-fault": scenario.fault } });
    const result: CompletionResult = await response.json() as CompletionResult;
    assert.equal(response.status, scenario.status, JSON.stringify({ scenario: scenario.name, result }));
    assert.equal(result.registered, scenario.status === 200 ? 1 : 0);
    if (scenario.status === 200) { assert.equal(result.result.pages, scenario.pages); assert.equal(result.state.state, "registered"); assert.equal(result.idempotent, true); assert.equal(result.usage.occupiedBytes, scenario.bytes.length); assert.equal(result.usage.reservedBytes, 0); }
    else { assert.equal(result.state.state, scenario.fault === "inventory-block" ? "verified" : "failed"); assert.equal(result.usage.reservedBytes, scenario.bytes.length); }
    await bucket.delete(result.objectKey);
    assert.deepEqual((await bucket.list()).objects.map((object): string => object.key), ["preserved-owner-file"]);
    results.push({ name: scenario.name, status: response.status, state: result.state.state, registered: result.registered });
  }
  await writeFile(".taskmaster/reports/task-5-complete-local.json", JSON.stringify({ status: "passed", environment: "local-workerd-d1-r2", tests: results.length, wholeOriginalAccumulated: false, unrelatedObjectPreserved: true, results }, null, 2) + "\n");
  console.log(JSON.stringify({ status: "passed", tests: results.length, results }));
} finally { await runtime.dispose(); }
