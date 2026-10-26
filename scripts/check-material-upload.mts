import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "vite";
import { Miniflare } from "miniflare";
import type { TransferSnapshot } from "../lib/materials/transfer-state.ts";
import type { MaterialUploadProof } from "../lib/materials/upload.ts";
import type { MaterialUsage } from "../db/repositories/material-transfers.ts";

type UploadResult = Readonly<{ result: MaterialUploadProof; state: TransferSnapshot; version: number; usage: MaterialUsage; object: Readonly<{ key: string; size: number; version: string; metadata: Readonly<Record<string, string>> }> | null }>;
type Scenario = Readonly<{ name: string; bytes: Uint8Array; expectedBytes: number; kind: "pdf" | "text"; sha256: string; fault: string; status: number; state: string; objectExists: boolean; declaredLength: string | null }>;
const output: string = path.resolve(".sites-runtime/material-upload-check");
await build({ configFile: false, logLevel: "warn", ssr: { noExternal: true, external: ["node:crypto"], target: "webworker" }, build: { ssr: "tests/fixtures/material-upload-worker.ts", target: "es2022", outDir: output, emptyOutDir: true, rollupOptions: { output: { entryFileNames: "worker.mjs" } } } });
const runtime: Miniflare = new Miniflare({ modules: true, scriptPath: path.join(output, "worker.mjs"), compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"], r2Buckets: ["BUCKET"], d1Databases: ["DB"], d1Persist: false, r2Persist: false, cf: false });
const results: Readonly<{ name: string; status: number; state: string; bytes: number; reservedBytes: number; maximumReadBufferBytes: number | null }>[] = [];
function hash(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
async function* body(bytes: Uint8Array): AsyncGenerator<Uint8Array> { for (let offset: number = 0; offset < bytes.length; offset += 65536) yield bytes.slice(offset, offset + 65536); }
try {
  const db = await runtime.getD1Database("DB");
  const journal: { entries: { tag: string }[] } = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
  for (const entry of journal.entries) for (const statement of (await readFile(`drizzle/${entry.tag}.sql`, "utf8")).split("--> statement-breakpoint").map((part: string): string => part.trim()).filter(Boolean)) await db.prepare(statement).run();
  const bucket = await runtime.getR2Bucket("BUCKET");
  await bucket.put("preserved-owner-file", "owner");
  const small: Uint8Array = new TextEncoder().encode("전송 검사 text\n");
  const maximumPdf: Uint8Array = new Uint8Array(20971520).fill(32); maximumPdf.set(new TextEncoder().encode("%PDF-1.7\n"));
  const maximumText: Uint8Array = new Uint8Array(1048576).fill(97);
  const base: Scenario = { name: "small-text", bytes: small, expectedBytes: small.length, kind: "text", sha256: hash(small), fault: "none", status: 200, state: "stored", objectExists: true, declaredLength: null };
  const scenarios: readonly Scenario[] = [base,
    { ...base, name: "concurrent-upload-single-winner", fault: "concurrent" },
    { ...base, name: "synthetic-client-abort-during-part", fault: "client-abort", status: 503, state: "failed", objectExists: false },
    { ...base, name: "20MiB-stream-no-content-validation-claim", bytes: maximumPdf, expectedBytes: maximumPdf.length, kind: "pdf", sha256: hash(maximumPdf) },
    { ...base, name: "1MiB-text-without-content-length", bytes: maximumText, expectedBytes: maximumText.length, sha256: hash(maximumText) },
    { ...base, name: "declared-length-mismatch", expectedBytes: small.length + 1, declaredLength: String(small.length), status: 400, state: "reserved", objectExists: false },
    { ...base, name: "actual-short-body", expectedBytes: small.length + 1, status: 400, state: "failed", objectExists: false },
    { ...base, name: "actual-long-body", expectedBytes: small.length - 1, status: 400, state: "failed", objectExists: false },
    { ...base, name: "checksum-mismatch", sha256: "b".repeat(64), status: 422, state: "failed", objectExists: false },
    { ...base, name: "disguised-pdf", kind: "pdf", status: 415, state: "reserved", objectExists: false },
    { ...base, name: "part-failure", fault: "part-failure", status: 503, state: "failed", objectExists: false },
    { ...base, name: "create-response-loss", fault: "create-response-loss", status: 503, state: "unknown", objectExists: false },
    { ...base, name: "complete-response-loss", fault: "complete-response-loss", status: 503, state: "unknown", objectExists: true },
  ];
  for (const scenario of scenarios) {
    const headers: Record<string, string> = { "content-type": scenario.kind === "text" ? "text/plain" : "application/pdf", "x-fixture-kind": scenario.kind, "x-fixture-filename": scenario.kind === "text" ? "fixture.txt" : "fixture.pdf", "x-fixture-bytes": String(scenario.expectedBytes), "x-fixture-sha256": scenario.sha256, "x-fixture-fault": scenario.fault };
    if (scenario.declaredLength !== null) headers["content-length"] = scenario.declaredLength;
    const response = await runtime.dispatchFetch("https://local.invalid/upload", { method: "PUT", body: body(scenario.bytes), duplex: "half", headers });
    const result: UploadResult = await response.json() as UploadResult;
    assert.equal(response.status, scenario.status, JSON.stringify({ name: scenario.name, result }));
    assert.equal(result.state.state, scenario.state, scenario.name);
    assert.equal(result.object !== null, scenario.objectExists, scenario.name);
    assert.equal(result.usage.reservedBytes, scenario.expectedBytes, scenario.name);
    if (scenario.status === 200) {
      assert.equal(result.result.transfer.sha256, scenario.sha256); assert.equal(result.result.transfer.bytes, scenario.expectedBytes);
      assert.ok(result.result.transfer.maximumReadBufferBytes <= 65536); assert.equal(result.object?.size, scenario.expectedBytes);
      assert.equal(result.object?.metadata.alterSha256, scenario.sha256);
    }
    if (result.object !== null) await bucket.delete(result.object.key);
    assert.deepEqual((await bucket.list()).objects.map((entry): string => entry.key), ["preserved-owner-file"]);
    results.push({ name: scenario.name, status: response.status, state: result.state.state, bytes: scenario.bytes.length, reservedBytes: result.usage.reservedBytes, maximumReadBufferBytes: scenario.status === 200 ? result.result.transfer.maximumReadBufferBytes : null });
  }
  await writeFile(".taskmaster/reports/task-5-upload-local.json", JSON.stringify({ status: "passed", environment: "local-workerd-d1-r2", tests: results.length, wholeOriginalAccumulated: false, contentValidationClaimed: false, retainedUnknownReservations: true, preservedUnrelatedObject: true, results }, null, 2) + "\n");
  console.log(JSON.stringify({ status: "passed", tests: results.length, results }));
} finally { await runtime.dispose(); }
