import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "vite";
import { Miniflare } from "miniflare";
import { readablePdf } from "../tests/fixtures/pdf-bytes.ts";

const output: string = path.resolve(".sites-runtime/weekly");
await build({ configFile: false, logLevel: "warn", plugins: [{ name: "extraction-test-wasm", enforce: "pre", resolveId(source: string) { if (source.endsWith(".wasm")) return { id: `./${path.basename(source)}`, external: true }; return null; } }], ssr: { noExternal: true, external: ["node:buffer", "node:crypto", "node:stream", "node:stream/promises", "node:zlib"], target: "webworker" }, build: { ssr: "tests/fixtures/weekly-worker.ts", target: "es2022", outDir: output, emptyOutDir: true, rollupOptions: { output: { entryFileNames: "worker.mjs" } } } });
await copyFile("lib/materials/pdf-wasm/validator.wasm", path.join(output, "validator.wasm"));
await copyFile("lib/materials/jpeg-wasm/decoder.wasm", path.join(output, "decoder.wasm"));
const runtime: Miniflare = new Miniflare({ modules: true, modulesRules: [{ type: "CompiledWasm", include: ["**/*.wasm"], fallthrough: true }], scriptPath: path.join(output, "worker.mjs"), compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"], r2Buckets: ["BUCKET"], d1Databases: ["DB"], d1Persist: false, r2Persist: false, cf: false });
try {
  const db = await runtime.getD1Database("DB");
  const journal: Readonly<{ entries: readonly Readonly<{ tag: string }>[] }> = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
  for (const entry of journal.entries) for (const statement of (await readFile(`drizzle/${entry.tag}.sql`, "utf8")).split("--> statement-breakpoint").map((part: string): string => part.trim()).filter(Boolean)) await db.prepare(statement).run();
  const bytes: Uint8Array = readablePdf(1);
  const response = await runtime.dispatchFetch("https://local.invalid/extraction", { method: "PUT", body: bytes, headers: { "content-type": "application/pdf", "x-fixture-kind": "pdf", "x-fixture-edition": "fixture-v1", "x-fixture-filename": "pages.pdf", "x-fixture-bytes": String(bytes.length), "x-fixture-sha256": createHash("sha256").update(bytes).digest("hex") } });
  const text: string = await response.text(); assert.equal(response.status, 200, text);
  const result: unknown = JSON.parse(text);
  await writeFile(".taskmaster/reports/task-13-local.json", JSON.stringify(result, null, 2) + "\n"); console.log(text);
} finally { await runtime.dispose(); }
