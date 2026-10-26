import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "vite";
import { Miniflare } from "miniflare";
import type { MaterialUsage } from "../db/repositories/material-transfers.ts";
import { textPdf } from "../tests/fixtures/pdf-bytes.ts";
import { indexedJpeg } from "../tests/fixtures/jpeg-mpf.ts";

type RecoveryResult = Readonly<{ firstError: string | null; interrupted: Readonly<{ state: string; reservedBytes: number; objectExists: boolean }> | null; fenced: boolean; replay: string | null; state: string; failureCode: string | null; usage: MaterialUsage; objectExists: boolean; objectKey: string; registered: number }>;
const output: string = path.resolve(".sites-runtime/material-recovery-check");
await build({ configFile: false, logLevel: "warn", plugins: [{ name: "complete-test-wasm", enforce: "pre", resolveId(source: string) { if (source.endsWith(".wasm")) return { id: `./${path.basename(source)}`, external: true }; return null; } }], ssr: { noExternal: true, external: ["node:crypto", "node:stream", "node:stream/promises", "node:zlib"], target: "webworker" }, build: { ssr: "tests/fixtures/material-recovery-worker.ts", target: "es2022", outDir: output, emptyOutDir: true, rollupOptions: { output: { entryFileNames: "worker.mjs" } } } });
await copyFile("lib/materials/pdf-wasm/validator.wasm", path.join(output, "validator.wasm"));
await copyFile("lib/materials/jpeg-wasm/decoder.wasm", path.join(output, "decoder.wasm"));
const runtime: Miniflare = new Miniflare({ modules: true, modulesRules: [{ type: "CompiledWasm", include: ["**/*.wasm"], fallthrough: true }], scriptPath: path.join(output, "worker.mjs"), compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"], r2Buckets: ["BUCKET"], d1Databases: ["DB"], d1Persist: false, r2Persist: false, cf: false });
const results: Readonly<{ name: string; state: string; registered: number; injectedFailurePreserved: boolean }>[] = [];
try {
  const db = await runtime.getD1Database("DB");
  const journal: { entries: { tag: string }[] } = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
  for (const entry of journal.entries) for (const statement of (await readFile(`drizzle/${entry.tag}.sql`, "utf8")).split("--> statement-breakpoint").map((part: string): string => part.trim()).filter(Boolean)) await db.prepare(statement).run();
  const bucket = await runtime.getR2Bucket("BUCKET");
  await bucket.put("preserved-owner-file", "owner");
  const textBytes: Uint8Array = new TextEncoder().encode("복구 검증 원본 text");
  const gray: Uint8Array = await readFile("tests/fixtures/jpeg/gray.jpg");
  const jpegBytes: Uint8Array = indexedJpeg(gray, gray, "big");
  const scenarios: readonly string[] = ["reserved", "no-multipart", "create-response-loss", "incomplete-part", "complete-response-loss", "late-complete", "abort-unconfirmed", "delete-response-loss", "delete-failure", "d1-after-delete", "registered", "foreign-owner", "changed-version", "concurrent", "failed-jpeg", "failed-jpeg-invalid", "failed-jpeg-stale", "failed-pdf", "failed-pdf-invalid", "failed-pdf-stale"];
  for (const scenario of scenarios) {
    const jpeg: boolean = scenario.startsWith("failed-jpeg");
    const pdf: boolean = scenario.startsWith("failed-pdf");
    const pdfBytes: Uint8Array = textPdf();
    const bytes: Uint8Array = pdf ? scenario === "failed-pdf-invalid" ? pdfBytes.subarray(0, -8) : pdfBytes : jpeg ? scenario === "failed-jpeg-invalid" ? jpegBytes.subarray(0, -2) : jpegBytes : textBytes;
    const response = await runtime.dispatchFetch("https://local.invalid/recover", { method: "PUT", body: bytes, headers: { "content-type": pdf ? "application/pdf" : jpeg ? "image/jpeg" : "text/plain", "content-length": String(bytes.length), "x-fixture-kind": pdf ? "pdf" : jpeg ? "image" : "text", "x-fixture-filename": pdf ? "fixture.pdf" : jpeg ? "fixture.jpeg" : "fixture.txt", "x-fixture-bytes": String(bytes.length), "x-fixture-sha256": createHash("sha256").update(bytes).digest("hex"), "x-fixture-fault": scenario } });
    assert.equal(response.status, 200, `${scenario}: ${response.status === 200 ? "" : await response.text()}`);
    const result: RecoveryResult = await response.json() as RecoveryResult;
    const registered: boolean = ["registered", "complete-response-loss", "concurrent", "failed-jpeg", "failed-pdf"].includes(scenario);
    const retained: boolean = ["foreign-owner", "changed-version", "failed-jpeg-invalid", "failed-jpeg-stale", "failed-pdf-invalid", "failed-pdf-stale"].includes(scenario);
    assert.equal(result.state, registered ? "registered" : retained ? jpeg || pdf ? "failed" : scenario === "changed-version" ? "cleaning" : "stored" : "discarded", JSON.stringify({ scenario, result }));
    assert.equal(result.registered, registered ? 1 : 0, scenario);
    assert.equal(result.objectExists, registered || retained, scenario);
    assert.equal(result.usage.reservedBytes, retained ? bytes.length : 0, scenario);
    if (!registered && !retained) assert.equal(result.replay, "discarded", scenario);
    if (["no-multipart", "create-response-loss", "late-complete"].includes(scenario)) assert.equal(result.fenced, true, scenario);
    if (["d1-after-delete", "delete-failure", "abort-unconfirmed"].includes(scenario)) {
      assert.ok(result.firstError); assert.equal(result.interrupted?.reservedBytes, bytes.length);
      assert.equal(result.interrupted?.state, scenario === "abort-unconfirmed" ? "unknown" : "cleaning");
      assert.equal(result.interrupted?.objectExists, scenario === "delete-failure");
    }
    if (["registered", "foreign-owner", "changed-version"].includes(scenario)) assert.ok(result.firstError);
    if (scenario === "failed-jpeg-invalid") assert.equal(result.failureCode, "material_content_invalid:jpeg:mpf-image-boundary");
    if (scenario === "failed-jpeg-stale") assert.equal(result.failureCode, "content-or-object-invalid");
    if (scenario === "failed-pdf-invalid") assert.equal(result.failureCode, "material_content_invalid:pdf:eof");
    if (scenario === "failed-pdf-stale") assert.equal(result.failureCode, "material_content_invalid:pdf:stream-decode-failed");
    await bucket.delete(result.objectKey);
    assert.deepEqual((await bucket.list()).objects.map((object): string => object.key), ["preserved-owner-file"]);
    results.push({ name: scenario, state: result.state, registered: result.registered, injectedFailurePreserved: result.interrupted !== null });
  }
  await writeFile(".taskmaster/reports/task-5-recovery-local.json", JSON.stringify({ status: "passed", environment: "local-workerd-d1-r2", tests: results.length, faults: "synthetic interruption and response loss around actual D1/R2 operations", unknownReservationsRetained: true, unrelatedObjectPreserved: true, results }, null, 2) + "\n");
  console.log(JSON.stringify({ status: "passed", tests: results.length, results }));
} finally { await runtime.dispose(); }
