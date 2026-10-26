import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { backupCatalog } from "../lib/backup/catalog.ts";
import type { BackupTableName } from "../lib/backup/catalog.ts";
import { backupPolicy } from "../lib/backup/contracts.ts";
import { startBackup, exportBackupPage, finishBackupDatabase, readBackupRun, cancelBackup } from "../db/repositories/backup.ts";
import type { AtomicDatabase } from "../db/repositories/atomic.ts";
import { siteIdentity } from "../lib/domain/contracts.ts";
import type { SiteIdentity } from "../lib/domain/contracts.ts";

const runtime: Miniflare = new Miniflare({ modules: true, script: "export default {fetch() {return new Response('backup-test');}}", compatibilityDate: "2026-05-15", d1Databases: ["DB"], d1Persist: false, cf: false });
const passed: string[] = [];
const owner: SiteIdentity = siteIdentity.parse({ realm: "sites", userId: "backup-main" });
const other: SiteIdentity = siteIdentity.parse({ realm: "sites", userId: "backup-other" });
const now: number = 100;
function id(): string { return crypto.randomUUID(); }
async function addCourse(db: AtomicDatabase, who: SiteIdentity, title: string): Promise<string> {
  const courseId: string = id();
  await db.prepare("INSERT INTO courses(owner_id,id,version,last_request_id,title) VALUES (?,?,1,?,?)").bind(who.userId, courseId, id(), title).run();
  return courseId;
}
async function begin(db: AtomicDatabase, who: SiteIdentity): Promise<string> { const backupId: string = id(); await startBackup(db, who, backupId, "fixture-project", now); return backupId; }
async function revision(db: AtomicDatabase, who: SiteIdentity): Promise<number> { return (await db.prepare("SELECT revision FROM backup_revisions WHERE owner_id=?").bind(who.userId).first<{ revision: number }>())?.revision ?? 0; }
/** 장애는 DB 경계에만 주입하며 실제 D1 쿼리·제약·롤백 동작은 그대로 사용합니다. */
function beforeBatch(db: AtomicDatabase, selected: number, hook: () => Promise<void>): AtomicDatabase {
  let ordinal: number = 0;
  return { prepare: db.prepare.bind(db), async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> { ordinal += 1; if (ordinal === selected) await hook(); return db.batch<T>(statements); } };
}
function loseResponse(db: AtomicDatabase, selected: number): AtomicDatabase {
  let ordinal: number = 0;
  return { prepare: db.prepare.bind(db), async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> { ordinal += 1; const result: D1Result<T>[] = await db.batch<T>(statements); if (ordinal === selected) throw new Error("network test: committed response lost"); return result; } };
}
async function exportAll(db: AtomicDatabase, who: SiteIdentity, backupId: string): Promise<void> {
  for (const table of backupCatalog) {
    for (let ordinal: number = 0; ; ordinal += 1) { const result = await exportBackupPage(db, who, backupId, table.name, ordinal); if (result.page.final) break; }
  }
}
try {
  const db = await runtime.getD1Database("DB") as unknown as AtomicDatabase;
  const journal: Readonly<{ entries: readonly Readonly<{ tag: string }>[] }> = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
  for (const entry of journal.entries) for (const statement of (await readFile(`drizzle/${entry.tag}.sql`, "utf8")).split("--> statement-breakpoint").map(part => part.trim()).filter(Boolean)) await db.prepare(statement).run();
  const triggers = await db.prepare("SELECT name,tbl_name,sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'backup_%'").all<{ name: string; tbl_name: string; sql: string }>();
  assert.equal(triggers.results.length, backupCatalog.length * 3);
  for (const table of backupCatalog) for (const kind of ["insert", "update", "delete"]) assert(triggers.results.some(trigger => trigger.name === `backup_${table.name}_${kind}` && trigger.tbl_name === table.name && trigger.sql.includes("backup_revisions")));
  passed.push("92 exported tables have insert/update/delete revision triggers; metadata and auth tables excluded");

  const courseId: string = await addCourse(db, owner, "기준 과정"); assert.equal(await revision(db, owner), 1);
  await db.prepare("UPDATE courses SET title='수정' WHERE owner_id=? AND id=?").bind(owner.userId, courseId).run(); assert.equal(await revision(db, owner), 2);
  await db.prepare("DELETE FROM courses WHERE owner_id=? AND id=?").bind(owner.userId, courseId).run(); assert.equal(await revision(db, owner), 3);
  const movedId: string = await addCourse(db, owner, "이동 과정");
  await db.prepare("UPDATE courses SET owner_id=? WHERE owner_id=? AND id=?").bind(other.userId, owner.userId, movedId).run();
  assert.equal(await revision(db, owner), 5); assert.equal(await revision(db, other), 1);
  passed.push("insert/update/delete and owner changes invalidate both affected owners");
  const before: number = await revision(db, owner);
  await assert.rejects(db.batch([db.prepare("INSERT INTO courses VALUES (?,?,1,?,?)").bind(owner.userId, id(), id(), "롤백"), db.prepare("INSERT INTO backup_checks(id,matched) VALUES (?,0)").bind(id())]), /backup_snapshot_matched/);
  assert.equal(await revision(db, owner), before); passed.push("failed transaction rolls back both learning data and revision");

  for (let i: number = 0; i < 75; i += 1) await addCourse(db, owner, `과정 ${i}`);
  const baseline: number = await revision(db, owner); const stable: string = await begin(db, owner);
  const restarted = await startBackup(db, owner, stable, "fixture-project", now + 10); assert.equal(restarted.basis.startedAt, now);
  assert.equal(await revision(db, owner), baseline); await assert.rejects(readBackupRun(db, other, stable), /missing-export/);
  await assert.rejects(exportBackupPage(db, other, stable, "courses", 0), /missing-export/);
  await assert.rejects(exportBackupPage(db, owner, stable, "courses;DROP TABLE courses" as BackupTableName, 0), /unknown-table/);
  passed.push("start retry preserves basis; other owner and dynamic table injection rejected");
  const first = await exportBackupPage(db, owner, stable, "courses", 0); assert.equal(first.page.rows.length, 32); assert.equal(first.page.final, false);
  assert.equal(first.entry.sha256, createHash("sha256").update(first.json).digest("hex"));
  const duplicate = await exportBackupPage(db, owner, stable, "courses", 0); assert.equal(duplicate.json, first.json);
  await assert.rejects(exportBackupPage(db, owner, stable, "courses", 2), /incomplete-export/);
  await assert.rejects(finishBackupDatabase(db, owner, stable), /incomplete-export/);
  const second = await exportBackupPage(db, owner, stable, "courses", 1); const third = await exportBackupPage(db, owner, stable, "courses", 2);
  assert.deepEqual([first.page.rows.length, second.page.rows.length, third.page.rows.length], [32, 32, 11]); assert(third.page.final);
  assert.equal(new Set([...first.page.rows, ...second.page.rows, ...third.page.rows].map(row => row.id)).size, 75);
  await assert.rejects(exportBackupPage(db, owner, stable, "courses", 3), /incomplete-export/);
  assert.equal(await revision(db, owner), baseline);
  passed.push("75 rows exported over three bounded pages with identical replay and no duplicates; missing pages rejected");

  await addCourse(db, other, "다른 계정 변경");
  assert((await readBackupRun(db, owner, stable)).current);
  await exportAll(db, owner, stable);
  const finished = await finishBackupDatabase(db, owner, stable);
  assert.equal(finished.run.state, "database-ready"); assert.equal(finished.counts.find(item => item.table === "courses")?.rows, 75);
  assert.equal(finished.pages.length, backupCatalog.length + 2); assert(!JSON.stringify(finished).includes('"state":"complete"'));
  assert.equal((await finishBackupDatabase(db, owner, stable)).pages.length, finished.pages.length);
  passed.push("all 92 table terminal pages and exact counts required; database-ready never claims complete manifest");

  await db.prepare("UPDATE courses SET title=title||' 변경' WHERE owner_id=? AND rowid=(SELECT min(rowid) FROM courses WHERE owner_id=?)").bind(owner.userId, owner.userId).run();
  assert.equal((await readBackupRun(db, owner, stable)).current, false);
  await assert.rejects(finishBackupDatabase(db, owner, stable), /export-conflict/);
  for (const kind of ["insert", "update", "delete"] as const) {
    const target: string = await addCourse(db, owner, "변경 대상"); const changing: string = await begin(db, owner); await exportBackupPage(db, owner, changing, "courses", 0);
    if (kind === "insert") await addCourse(db, owner, "추가");
    if (kind === "update") await db.prepare("UPDATE courses SET title='변경' WHERE owner_id=? AND id=?").bind(owner.userId, target).run();
    if (kind === "delete") await db.prepare("DELETE FROM courses WHERE owner_id=? AND id=?").bind(owner.userId, target).run();
    await assert.rejects(exportBackupPage(db, owner, changing, "courses", 1), /export-conflict/);
  }
  passed.push("insert/update/delete between pages and mutation after database-ready reject stale snapshot");
  for (const stage of [1, 2, 3]) {
    const racing: string = await begin(db, owner);
    const raced = beforeBatch(db, stage, async () => { await addCourse(db, owner, "경계 경합"); });
    await assert.rejects(exportBackupPage(raced, owner, racing, "courses", 0), /export-conflict/);
    assert.equal((await db.prepare("SELECT count(*) AS total FROM backup_pages WHERE owner_id=? AND backup_id=?").bind(owner.userId, racing).first<{ total: number }>())?.total, 0);
  }
  passed.push("mutation before size read, row read, or post-hash receipt blocks partial success");

  const lostStart: string = id(); await startBackup(loseResponse(db, 1), owner, lostStart, "fixture-project", now);
  const lost = await exportBackupPage(loseResponse(db, 3), owner, lostStart, "courses", 0);
  assert.equal((await exportBackupPage(db, owner, lostStart, "courses", 0)).entry.sha256, lost.entry.sha256);
  assert.equal((await db.prepare("SELECT count(*) AS total FROM backup_pages WHERE owner_id=? AND backup_id=?").bind(owner.userId, lostStart).first<{ total: number }>())?.total, 1);
  passed.push("lost start and committed-page responses retry same identity with one receipt");
  let failures: number = 0;
  const failing: AtomicDatabase = { prepare: db.prepare.bind(db), async batch(): Promise<never> { failures += 1; throw new Error("network test: unavailable D1"); } };
  await assert.rejects(exportBackupPage(failing, owner, lostStart, "courses", 1), /storage_failure/); assert.equal(failures, 3);
  assert.equal((await readBackupRun(db, owner, lostStart)).state, "exporting");
  passed.push("D1 read failure warns and stops after three attempts; no completed result");

  const finalRace: string = await begin(db, owner); await exportAll(db, owner, finalRace);
  await assert.rejects(finishBackupDatabase(beforeBatch(db, 3, async () => { await addCourse(db, owner, "확정 경합"); }), owner, finalRace), /export-conflict/);
  assert.equal((await readBackupRun(db, owner, finalRace)).state, "exporting");
  passed.push("mutation after full count validation but before final transaction blocks database-ready");
  const cancelled: string = await begin(db, owner); assert.equal((await cancelBackup(db, owner, cancelled)).state, "cancelled");
  await assert.rejects(exportBackupPage(db, owner, cancelled, "courses", 0), /export-conflict/);
  assert.equal((await cancelBackup(db, owner, cancelled)).state, "cancelled");
  passed.push("cancel is idempotent and cannot resume incomplete export");

  const learner: SiteIdentity = siteIdentity.parse({ realm: "sites", userId: "backup-recall" });
  const learnerCourse: string = await addCourse(db, learner, "진행 중 학습");
  const unitId: string = id(); const planId: string = id(); const planVersionId: string = id(); const sessionId: string = id(); const questionId: string = id(); const attemptId: string = id();
  await db.batch([
    db.prepare("INSERT INTO units VALUES (?,?,1,?,?,1,'분수')").bind(learner.userId, unitId, id(), learnerCourse),
    db.prepare("INSERT INTO plans VALUES (?,?,1,?,?,'학습 계획')").bind(learner.userId, planId, id(), learnerCourse),
    db.prepare("INSERT INTO plan_versions VALUES (?,?,?,?,1,?,100)").bind(learner.userId, planVersionId, planId, learnerCourse, JSON.stringify({ unitIds: [unitId] })),
    db.prepare("INSERT INTO sessions VALUES (?,?,1,?,?,?,?,'2026-10-25','active')").bind(learner.userId, sessionId, id(), learnerCourse, unitId, planVersionId),
    db.prepare("INSERT INTO questions VALUES (?,?,?,NULL,'인출 질문')").bind(learner.userId, questionId, sessionId),
    db.prepare("INSERT INTO attempts VALUES (?,?,1,?,?,?,NULL,'initial',1,'awaiting-answer')").bind(learner.userId, attemptId, id(), sessionId, questionId),
  ]);
  await assert.rejects(begin(db, learner), /learning-active/);
  assert.equal((await db.prepare("SELECT count(*) AS total FROM backup_runs WHERE owner_id=?").bind(learner.userId).first<{ total: number }>())?.total, 0);
  await db.prepare("UPDATE attempts SET status='awaiting-revision' WHERE owner_id=? AND id=?").bind(learner.userId, attemptId).run();
  const submitted: string = await begin(db, learner); assert((await exportBackupPage(db, learner, submitted, "attempts", 0)).page.final);
  passed.push("unsubmitted learning blocks backup source exposure; submitted history remains exportable");

  const largeOwner: SiteIdentity = siteIdentity.parse({ realm: "sites", userId: "backup-large" });
  for (let i: number = 0; i < 10; i += 1) await addCourse(db, largeOwner, "한".repeat(500_000));
  const large: string = await begin(db, largeOwner); let total: number = 0; let maxBytes: number = 0; let pages: number = 0;
  for (let ordinal: number = 0; ; ordinal += 1) { const page = await exportBackupPage(db, largeOwner, large, "courses", ordinal); total += page.page.rows.length; maxBytes = Math.max(maxBytes, page.entry.bytes); pages += 1; assert(page.entry.bytes <= backupPolicy.maximumPageBytes); assert(page.page.rows.length <= 2); if (page.page.final) break; }
  assert.equal(total, 10); assert.equal(pages, 5); assert(maxBytes > 3_000_000);
  passed.push("15MB Korean text exported in five sub-4MiB pages; no full-table body read");
  const hugeOwner: SiteIdentity = siteIdentity.parse({ realm: "sites", userId: "backup-huge-json" }); await addCourse(db, hugeOwner, "\u0001".repeat(800_000));
  const huge: string = await begin(db, hugeOwner); await assert.rejects(exportBackupPage(db, hugeOwner, huge, "courses", 0), /page-too-large/);
  passed.push("oversized escaped JSON row rejected at metadata stage before body query");
  assert.equal((await db.prepare("SELECT count(*) AS total FROM backup_checks").first<{ total: number }>())?.total, 0);
  passed.push("all transient transaction guard rows cleaned or rolled back");
  const result = { status: "passed", scope: "local Miniflare D1 with all migrations", checks: passed, largeDataset: { totalUtf8Bytes: 15_000_000, pages, maximumPageBytes: maxBytes }, liveD1: "not-yet-performed", liveAiCalls: 0, liveGoogleCalls: 0 };
  await writeFile(".taskmaster/reports/task-17-backup-database-local.json", JSON.stringify(result, null, 2) + "\n"); console.log(JSON.stringify(result));
} finally { await runtime.dispose(); }
