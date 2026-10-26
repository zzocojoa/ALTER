import { assertNoVerificationRecords } from "../tests/fixtures/diagnostic-cleanup.ts";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { runDataAcceptance } from "../lib/data-acceptance.ts";

const runtime: Miniflare = new Miniflare({ modules: true, script: "export default {fetch() {return new Response('data-acceptance');}}", compatibilityDate: "2026-05-15", d1Databases: ["DB"], d1Persist: false, cf: false });
try {
  const db = await runtime.getD1Database("DB");
  const journal: { entries: { tag: string }[] } = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
  for (const entry of journal.entries) {
    const migration: string = await readFile(`drizzle/${entry.tag}.sql`, "utf8");
    for (const statement of migration.split("--> statement-breakpoint").map((part: string): string => part.trim()).filter(Boolean)) await db.prepare(statement).run();
    if (entry.tag.startsWith("0000")) await db.prepare("INSERT INTO owner_enrollment VALUES (1,'migration-preservation-fixture',123)").run();
  }
  assert.equal(await db.prepare("SELECT requested_at FROM owner_enrollment WHERE slot = 1").first<number>("requested_at"), 123);
  await db.prepare("INSERT INTO backup_revisions(owner_id,revision) VALUES ('owner-cleanup-preservation',99)").run();
  const result = await runDataAcceptance(db as unknown as D1Database, "local-workerd");
  await assertNoVerificationRecords(db as unknown as D1Database);
  await db.prepare("CREATE TRIGGER diagnostic_failure_fixture BEFORE INSERT ON external_jobs WHEN NEW.owner_id LIKE 'verification:%' BEGIN SELECT RAISE(ABORT,'diagnostic_failure_fixture'); END").run();
  await assert.rejects(runDataAcceptance(db as unknown as D1Database, "local-workerd"), (error: unknown): boolean => error instanceof Error && error.cause instanceof Error && error.cause.message.includes("diagnostic_failure_fixture"));
  await assertNoVerificationRecords(db as unknown as D1Database);
  assert.equal(await db.prepare("SELECT revision FROM backup_revisions WHERE owner_id='owner-cleanup-preservation'").first<number>("revision"), 99);
  console.log(JSON.stringify({check:"data-diagnostic-cleanup",successAndFailureAllOwnerTablesEmpty:true,otherOwnerPreserved:true}));
  await writeFile(".taskmaster/reports/task-3-local-data.json", JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
} finally { await runtime.dispose(); }
