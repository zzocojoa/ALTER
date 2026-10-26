import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { assessMigration } from "../lib/domain/migrations.ts";
import type { SchemaObject } from "../lib/domain/migrations.ts";

type MigrationManifest = Readonly<{ files: Readonly<Record<string, string>> }>;
const manifest: MigrationManifest = JSON.parse(await readFile("drizzle/integrity.json", "utf8"));
for (const [file, hash] of Object.entries(manifest.files)) assert.equal(createHash("sha256").update(await readFile(file)).digest("hex"), hash, `마이그레이션 변조: ${file}`);
const tracked: string[] = execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD", "drizzle"], { encoding: "utf8" }).trim().split("\n").filter((file: string): boolean => /\.sql$|\d+_snapshot\.json$/.test(file));
for (const file of tracked) assert.equal(await readFile(file, "utf8"), execFileSync("git", ["show", `HEAD:${file}`], { encoding: "utf8" }), `이미 기록된 마이그레이션 변경: ${file}`);
const oldJournal = JSON.parse(execFileSync("git", ["show", "HEAD:drizzle/meta/_journal.json"], { encoding: "utf8" }));
const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
assert.deepEqual(journal.entries.slice(0, oldJournal.entries.length), oldJournal.entries);
const runtime: Miniflare = new Miniflare({ modules: true, script: "export default {fetch() {return new Response('migration-check');}}", compatibilityDate: "2026-05-15", d1Databases: ["DB"], d1Persist: false, cf: false });
try {
  const db = await runtime.getD1Database("DB");
  const statements: string[] = (await readFile("drizzle/0001_tranquil_thing.sql", "utf8")).split("--> statement-breakpoint").map((sql: string): string => sql.trim()).filter(Boolean);
  const expected: readonly SchemaObject[] = [{ name: "answer_drafts", sql: statements[0].replace(/;$/, "") }, { name: "answers", sql: statements[1].replace(/;$/, "") }];
  assert.equal(assessMigration("hash", null, expected, []), "pending");
  await db.prepare(statements[0]).run();
  await assert.rejects(db.prepare("CREATE TABLE invalid_schema (").run(), /syntax|incomplete/i);
  const observed = await db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name IN ('answer_drafts','answers')").all<SchemaObject>();
  assert.equal(assessMigration("hash", null, expected, observed.results), "stop-and-inspect");
  const original: Buffer = await readFile("drizzle/0000_mixed_hannibal_king.sql");
  assert.notEqual(createHash("sha256").update(Buffer.concat([original, Buffer.from(" -- changed")])).digest("hex"), manifest.files["drizzle/0000_mixed_hannibal_king.sql"]);
  console.log(JSON.stringify({ status: "passed", check: "migration-integrity", files: Object.keys(manifest.files).length, preserved: tracked.length, interruptedLocalD1: "stop-and-inspect", mutationDetection: "passed" }));
} finally { await runtime.dispose(); }
