import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "vite";
import { Miniflare } from "miniflare";

const output: string = path.resolve(".sites-runtime/external");
await build({ configFile: false, logLevel: "warn", ssr: { noExternal: true, target: "webworker" }, build: { ssr: "tests/fixtures/external-worker.ts", target: "es2022", outDir: output, emptyOutDir: true, rollupOptions: { output: { entryFileNames: "worker.mjs" } } } });
const runtime: Miniflare = new Miniflare({ modules: true, scriptPath: path.join(output, "worker.mjs"), compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"], d1Databases: ["DB"], d1Persist: false, cf: false });
try {
  const db = await runtime.getD1Database("DB");
  const journal: Readonly<{ entries: readonly Readonly<{ tag: string }>[] }> = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
  for (const entry of journal.entries) for (const statement of (await readFile(`drizzle/${entry.tag}.sql`, "utf8")).split("--> statement-breakpoint").map((part: string): string => part.trim()).filter(Boolean)) await db.prepare(statement).run();
  const response: Awaited<ReturnType<Miniflare["dispatchFetch"]>> = await runtime.dispatchFetch("https://local.invalid/external");
  const body: string = await response.text(); assert.equal(response.status, 200, body);
  const result: unknown = JSON.parse(body);
  await writeFile(".taskmaster/reports/task-15-local.json", JSON.stringify(result, null, 2) + "\n"); console.log(body);
} finally { await runtime.dispose(); }
