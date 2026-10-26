import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "vite";
import { Miniflare } from "miniflare";

const output: string = path.resolve(".sites-runtime/material-access-check");
await build({ configFile: false, logLevel: "warn", plugins: [{ name: "complete-test-wasm", enforce: "pre", resolveId(source: string) { if (source.endsWith(".wasm")) return { id: `./${path.basename(source)}`, external: true }; return null; } }], ssr: { noExternal: true, external: ["node:crypto", "node:stream", "node:stream/promises", "node:zlib"], target: "webworker" }, build: { ssr: "tests/fixtures/material-access-worker.ts", target: "es2022", outDir: output, emptyOutDir: true, rollupOptions: { output: { entryFileNames: "worker.mjs" } } } });
await copyFile("lib/materials/pdf-wasm/validator.wasm", path.join(output, "validator.wasm"));
await copyFile("lib/materials/jpeg-wasm/decoder.wasm", path.join(output, "decoder.wasm"));
const runtime: Miniflare = new Miniflare({ modules: true, modulesRules: [{ type: "CompiledWasm", include: ["**/*.wasm"], fallthrough: true }], scriptPath: path.join(output, "worker.mjs"), compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"], r2Buckets: ["BUCKET"], d1Databases: ["DB"], d1Persist: false, r2Persist: false, cf: false });
const results: Readonly<{ status: string; checks: number; role: string; exposureCount: number; helpCount: number; attached: number }>[] = [];
try {
  const db = await runtime.getD1Database("DB");
  const journal: { entries: { tag: string }[] } = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
  for (const entry of journal.entries) for (const statement of (await readFile(`drizzle/${entry.tag}.sql`, "utf8")).split("--> statement-breakpoint").map((part: string): string => part.trim()).filter(Boolean)) await db.prepare(statement).run();
  const bucket = await runtime.getR2Bucket("BUCKET");
  await bucket.put("preserved-owner-file", "owner");
  for (const role of ["reference", "answer"]) {
    const bytes: Uint8Array = role === "answer" ? await readFile("tests/fixtures/jpeg/gray.jpg") : new TextEncoder().encode("자료 원본");
    const response = await runtime.dispatchFetch("https://local.invalid/access", { method: "PUT", body: bytes, headers: { "content-type": role === "answer" ? "image/jpeg" : "text/plain", "x-fixture-kind": role === "answer" ? "image" : "text", "x-fixture-role": role, "x-fixture-filename": role === "answer" ? "answer.jpg" : "reference.txt", "x-fixture-bytes": String(bytes.length), "x-fixture-sha256": createHash("sha256").update(bytes).digest("hex") } });
    assert.equal(response.status, 200, response.status === 200 ? role : await response.text());
    const result = await response.json() as Readonly<{ status: string; checks: number; role: string; exposureCount: number; helpCount: number; attached: number; objectKey: string }>;
    assert.equal(result.status, "passed");
    assert.equal(result.attached, role === "answer" ? 1 : 0);
    await bucket.delete(result.objectKey);
    assert.deepEqual((await bucket.list()).objects.map((object): string => object.key), ["preserved-owner-file"]);
    results.push({ status: result.status, checks: result.checks, role: result.role, exposureCount: result.exposureCount, helpCount: result.helpCount, attached: result.attached });
  }
  await writeFile(".taskmaster/reports/task-5-access-local.json", JSON.stringify({ status: "passed", environment: "local-workerd-d1-r2", tests: results.reduce((sum, result): number => sum + result.checks, 0), wholeOriginalAccumulated: false, unrelatedObjectPreserved: true, results }, null, 2) + "\n");
  console.log(JSON.stringify({ status: "passed", tests: results.reduce((sum, result): number => sum + result.checks, 0), results }));
} finally { await runtime.dispose(); }
