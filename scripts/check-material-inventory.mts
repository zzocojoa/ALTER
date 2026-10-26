import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "vite";
import { Miniflare } from "miniflare";

const output: string = path.resolve(".sites-runtime/material-inventory-check");
await build({ configFile: false, logLevel: "warn", ssr: { noExternal: true, target: "webworker" }, build: { ssr: "tests/fixtures/material-inventory-worker.ts", target: "es2022", outDir: output, emptyOutDir: true, rollupOptions: { output: { entryFileNames: "worker.mjs" } } } });
const runtime: Miniflare = new Miniflare({ modules: true, scriptPath: path.join(output, "worker.mjs"), compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"], r2Buckets: ["BUCKET"], d1Databases: ["DB"], d1Persist: false, r2Persist: false, cf: false });
try {
  const db = await runtime.getD1Database("DB");
  const journal: { entries: { tag: string }[] } = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
  for (const entry of journal.entries) for (const statement of (await readFile(`drizzle/${entry.tag}.sql`, "utf8")).split("--> statement-breakpoint").map((part: string): string => part.trim()).filter(Boolean)) await db.prepare(statement).run();
  const bucket = await runtime.getR2Bucket("BUCKET");
  await bucket.put("preserved-owner-file", "owner");
  const response = await runtime.dispatchFetch("https://local.invalid/check");
  assert.equal(response.status, 200, response.status === 200 ? "inventory" : await response.text());
  const result: unknown = await response.json();
  assert.deepEqual((await bucket.list()).objects.map((object): string => object.key), ["preserved-owner-file"]);
  await writeFile(".taskmaster/reports/task-5-inventory-local.json", JSON.stringify({ environment: "local-workerd-d1-r2", result, unrelatedObjectPreserved: true }, null, 2) + "\n");
  console.log(JSON.stringify(result));
} finally { await runtime.dispose(); }
