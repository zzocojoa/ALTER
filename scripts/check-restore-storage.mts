import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { build } from "vite";
import path from "node:path";
import { receiveRestoreManifest, receiveRestorePage, readRestoreManifest } from "../db/repositories/restore-receiving.ts";
import { restoreDocumentKey } from "../lib/backup/restore-document.ts";
import { createRestoreChallenge, startRestoreRun, readRestoreRun } from "../db/repositories/restore-run.ts";
import { approveBackupRestore } from "../db/repositories/restore-approval.ts";
import { restorePublicKeyHash } from "../lib/backup/restore-authority.ts";
import type { RestoreTrust } from "../lib/backup/restore-authority.ts";
import { startBackup, exportBackupPage } from "../db/repositories/backup.ts";
import { acknowledgeBackupPage, completeBackup } from "../db/repositories/backup-completion.ts";
import { backupCatalog } from "../lib/backup/catalog.ts";
import { verifyMaterialInventory } from "../lib/materials/inventory.ts";
import { registerPrimaryStorage, registerRestoreStorage, readRegisteredStorage } from "../db/repositories/restore-storage.ts";
import type { RegisteredStorage } from "../db/repositories/restore-storage.ts";
import type { AtomicDatabase } from "../db/repositories/atomic.ts";
import { storageMarkerKey } from "../lib/backup/storage-identity.ts";
import type { StorageContext } from "../lib/backup/storage-identity.ts";

const workerOutput: string = path.resolve(".sites-runtime/restore-crypto");
await build({ configFile: false, logLevel: "warn", ssr: { noExternal: true, target: "webworker" }, build: { ssr: "tests/fixtures/restore-crypto-worker.ts", target: "es2022", outDir: workerOutput, emptyOutDir: true, rollupOptions: { output: { entryFileNames: "worker.mjs" } } } });
const runtime: Miniflare = new Miniflare({ modules: true, scriptPath: path.join(workerOutput, "worker.mjs"), compatibilityDate: "2026-05-15", d1Databases: ["PRIMARY", "TARGET", "FAILURE"], r2Buckets: ["PRIMARY", "TARGET", "FAILURE"], d1Persist: false, r2Persist: false, cf: false });
const sourceContext: StorageContext = { projectId: "source-site", owner: { realm: "sites", userId: "source-owner" } };
const targetContext: StorageContext = { projectId: "target-site", owner: { realm: "sites", userId: "target-owner" } };
const failedContext: StorageContext = { projectId: "retry-site", owner: sourceContext.owner };
const checks: string[] = [];
/** 실제 D1 배치에서만 완료 직전 오류나 응답 유실을 주입합니다. */
function injectedDatabase(db: AtomicDatabase, inject: (statements: readonly D1PreparedStatement[], ordinal: number) => Promise<void>): AtomicDatabase {
  let ordinal: number = 0;
  return { prepare: db.prepare.bind(db), async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> { ordinal += 1; await inject(statements, ordinal); return db.batch<T>(statements); } };
}
function loseCommittedResponse(db: AtomicDatabase): AtomicDatabase {
  let lost: boolean = false;
  return { prepare: db.prepare.bind(db), async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> { const result = await db.batch<T>(statements); if (!lost) { lost = true; throw new Error("network: registration committed, response lost"); } return result; } };
}
function bucketWithPut(bucket: R2Bucket, put: R2Bucket["put"]): R2Bucket { return new Proxy(bucket, { get(target, property) { const value = Reflect.get(target, property, target); return property === "put" ? put : typeof value === "function" ? value.bind(target) : value; } }); }
async function state(db: AtomicDatabase): Promise<Readonly<{ identity: string; state: string }> | null> { return db.prepare("SELECT identity,state FROM restore_storage WHERE slot=1").first<{ identity: string; state: string }>(); }
try {
  const cryptoResponse = await runtime.dispatchFetch("https://restore-test.invalid/");
  assert.equal(cryptoResponse.status, 200); assert.deepEqual(await cryptoResponse.json(), { status: "passed", privateKeyExtractable: false, differentOwners: true, executionAuthority: "none", googleConsent: "required" });
  checks.push("real workerd imports configured Ed25519 keys, signs and verifies bound owner approval; private key non-extractable");
  const primary = await runtime.getD1Database("PRIMARY") as unknown as AtomicDatabase;
  const target = await runtime.getD1Database("TARGET") as unknown as AtomicDatabase;
  const failure = await runtime.getD1Database("FAILURE") as unknown as AtomicDatabase;
  const primaryBucket = await runtime.getR2Bucket("PRIMARY") as unknown as R2Bucket;
  const targetBucket = await runtime.getR2Bucket("TARGET") as unknown as R2Bucket;
  const failureBucket = await runtime.getR2Bucket("FAILURE") as unknown as R2Bucket;
  const journal: Readonly<{ entries: readonly Readonly<{ tag: string }>[] }> = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
  for (const entry of journal.entries) {
    const sql = (await readFile(`drizzle/${entry.tag}.sql`, "utf8")).split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean);
    for (const db of [primary, target, failure]) for (const statement of sql) await db.prepare(statement).run();
  }
  await primary.prepare("INSERT INTO courses(owner_id,id,version,last_request_id,title) VALUES (?,?,1,?,?)").bind(sourceContext.owner.userId, crypto.randomUUID(), crypto.randomUUID(), "운영 자료").run();
  await primaryBucket.put("existing-material.bin", "existing-original");
  const source: RegisteredStorage = await registerPrimaryStorage(primary, primaryBucket, sourceContext, sourceContext.owner, 100);
  assert.deepEqual(await registerPrimaryStorage(primary, primaryBucket, sourceContext, sourceContext.owner, 200), source);
  assert.equal(await (await primaryBucket.get("existing-material.bin"))?.text(), "existing-original");
  assert(source.markerBytes > 0 && source.markerBytes <= 2048);
  checks.push("primary registration preserves existing records/originals; repeat keeps both marker IDs and byte receipt");

  await assert.rejects(registerRestoreStorage(target, targetBucket, targetContext, sourceContext.owner, source.identity, 100), /wrong-owner/);
  await assert.rejects(registerRestoreStorage(target, targetBucket, sourceContext, sourceContext.owner, source.identity, 100), /unsafe-target/);
  await assert.rejects(registerRestoreStorage(primary, targetBucket, targetContext, targetContext.owner, source.identity, 100), /unsafe-target/);
  await assert.rejects(registerRestoreStorage(target, primaryBucket, targetContext, targetContext.owner, source.identity, 100), /unsafe-target/);
  assert.equal(await state(target), null);
  checks.push("unverified owner and same Site, actual D1 or actual R2 refused before target registration");

  await target.prepare("CREATE TABLE __appgarden_migrations(id TEXT PRIMARY KEY)").run();
  await target.prepare("INSERT INTO __appgarden_migrations VALUES ('platform-applied-migration')").run();
  await targetBucket.put("unexpected.bin", "unexpected");
  await assert.rejects(registerRestoreStorage(target, targetBucket, targetContext, targetContext.owner, source.identity, 100), /nonempty-bucket/);
  await targetBucket.delete("unexpected.bin");
  await target.prepare("CREATE TABLE future_business_records(id TEXT PRIMARY KEY)").run();
  await target.prepare("INSERT INTO future_business_records VALUES ('present')").run();
  await assert.rejects(registerRestoreStorage(target, targetBucket, targetContext, targetContext.owner, source.identity, 100), /nonempty-database:future_business_records/);
  assert.equal(await state(target), null); assert.equal(await targetBucket.get(storageMarkerKey), null);
  await target.prepare("DELETE FROM future_business_records").run();
  checks.push("nonempty bucket and newly added nonempty business table rejected with no marker or registration");

  const marked = await registerRestoreStorage(loseCommittedResponse(target), targetBucket, targetContext, targetContext.owner, source.identity, 100);
  assert.equal((await target.prepare("SELECT COUNT(*) AS n FROM __appgarden_migrations").first<{ n: number }>())?.n, 1);
  assert.notEqual(marked.identity.databaseId, source.identity.databaseId); assert.notEqual(marked.identity.bucketId, source.identity.bucketId);
  assert.equal(marked.identity.owner.userId, targetContext.owner.userId); assert.equal(marked.identity.purpose, "restore-test");
  assert.deepEqual(await registerRestoreStorage(target, targetBucket, targetContext, targetContext.owner, source.identity, 200), marked);
  assert.equal((await target.prepare("SELECT count(*) AS n FROM backup_checks").first<{ n: number }>())?.n, 0);
  checks.push("different confirmed owner and isolated D1/R2 registered; lost DB response reconciles without new IDs or leaked guards");

  const unavailable = bucketWithPut(failureBucket, async () => { throw new Error("network: R2 write unavailable"); });
  await assert.rejects(registerRestoreStorage(failure, unavailable, failedContext, failedContext.owner, source.identity, 100), /R2 write unavailable/);
  const reserved = await state(failure); assert.equal(reserved?.state, "reserved");
  await assert.rejects(failure.prepare("UPDATE restore_storage SET state='ready',marker_version='fake',marker_bytes=100,ready_at=NULL WHERE slot=1").run(), /restore_storage_state/);
  assert.equal(await failureBucket.get(storageMarkerKey), null);
  checks.push("R2 failure leaves reserved state and never ready; bounded retries preserve explicit error");

  await failure.prepare("CREATE TRIGGER inject_update_zero BEFORE UPDATE ON restore_storage WHEN NEW.state='ready' BEGIN SELECT RAISE(IGNORE); END").run();
  await assert.rejects(registerRestoreStorage(failure, failureBucket, failedContext, failedContext.owner, source.identity, 200), /storage_failure/);
  assert.deepEqual(await state(failure), reserved); assert(await failureBucket.get(storageMarkerKey));
  await failure.prepare("DROP TRIGGER inject_update_zero").run();
  checks.push("UPDATE zero triggers unconditional CHECK rollback; R2 marker retained for explicit resume");

  const failedBatch = injectedDatabase(failure, async (statements, ordinal) => { if (ordinal === 2) await failure.batch([...statements, failure.prepare("INSERT INTO backup_checks(id,matched) VALUES ('injected',0)")]); });
  await assert.rejects(registerRestoreStorage(failedBatch, failureBucket, failedContext, failedContext.owner, source.identity, 300), /storage_failure/);
  assert.deepEqual(await state(failure), reserved);
  checks.push("failure after ready UPDATE within batch rolls all DB changes back");

  await failureBucket.delete(storageMarkerKey);
  let lostPut: boolean = false;
  const lostBucket = bucketWithPut(failureBucket, (async (...args: Parameters<R2Bucket["put"]>) => { const result = await failureBucket.put(...args); if (!lostPut) { lostPut = true; throw new Error("network: R2 committed response lost"); } return result; }) as R2Bucket["put"]);
  const resumed = await registerRestoreStorage(failure, lostBucket, failedContext, failedContext.owner, source.identity, 400);
  assert.deepEqual(resumed.identity, JSON.parse(reserved!.identity));
  assert.equal((await state(failure))?.state, "ready");
  checks.push("interrupted registration resumes same IDs; lost R2 response compares saved bytes before accepting completion");

  const usage = await verifyMaterialInventory(primary, primaryBucket, sourceContext.owner, 1000);
  assert.equal(usage.usage.untrackedBytes, 1024 + 2048 + new TextEncoder().encode("existing-original").byteLength);
  checks.push("marker reserves 2048 bytes before creation; inventory counts its reserved capacity exactly once");

  const pair: CryptoKeyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const trust: RestoreTrust = { source: source.identity, publicKey: pair.publicKey, keySha256: await restorePublicKeyHash(pair.publicKey) };
  const challengeId: string = crypto.randomUUID();
  const challenge = await createRestoreChallenge(target, targetBucket, targetContext, targetContext.owner, challengeId, 1000, 61000);
  assert.deepEqual(await createRestoreChallenge(target, targetBucket, targetContext, targetContext.owner, challengeId, 1100, 62000), challenge);
  await assert.rejects(createRestoreChallenge(target, targetBucket, targetContext, sourceContext.owner, crypto.randomUUID(), 1000, 61000), /wrong-owner/);
  await assert.rejects(createRestoreChallenge(target, targetBucket, targetContext, targetContext.owner, challengeId, 61000, 121000), /invalid-time/);
  checks.push("server owner-bound challenge persists; retries never extend lifetime and another owner cannot issue it");

  const backupId: string = crypto.randomUUID(); await startBackup(primary, sourceContext.owner, backupId, sourceContext.projectId, 1000);
  await assert.rejects(approveBackupRestore(primary, primaryBucket, sourceContext, sourceContext.owner, pair.privateKey, challenge, backupId, 1100), /incomplete-export/);
  const archivePages: Map<string, string> = new Map();
  for (const table of backupCatalog) for (let ordinal: number = 0; ; ordinal += 1) {
    const result = await exportBackupPage(primary, sourceContext.owner, backupId, table.name, ordinal);
    archivePages.set(result.entry.path, result.json);
    await acknowledgeBackupPage(primary, sourceContext.owner, backupId, table.name, ordinal, result.entry.sha256, result.entry.bytes, 1200);
    if (result.page.final) break;
  }
  const manifest = await completeBackup(primary, sourceContext.owner, backupId, 1300);
  const approval = await approveBackupRestore(primary, primaryBucket, sourceContext, sourceContext.owner, pair.privateKey, challenge, backupId, 1400);
  const runId: string = crypto.randomUUID();
  const start = (db: AtomicDatabase): ReturnType<typeof startRestoreRun> => startRestoreRun(db, targetBucket, targetContext, targetContext.owner, trust, approval.token, runId, challengeId, backupId, approval.manifestSha256, 1500);
  await assert.rejects(startRestoreRun(target, targetBucket, targetContext, targetContext.owner, trust, approval.token, runId, challengeId, backupId, "0".repeat(64), 1500), /wrong-backup/);
  checks.push("source signs only receipt-reconstructed completed backup; alternate manifest hash rejected");

  await target.prepare("CREATE TRIGGER consume_zero BEFORE UPDATE ON restore_challenges BEGIN SELECT RAISE(IGNORE); END").run();
  await assert.rejects(start(target), /storage_failure/);
  assert.equal(await target.prepare("SELECT count(*) AS n FROM restore_runs").first<number>("n"), 0);
  assert.equal(await target.prepare("SELECT consumed_at FROM restore_challenges WHERE id=?").bind(challengeId).first<number>("consumed_at"), null);
  await target.prepare("DROP TRIGGER consume_zero").run();
  const midFailure = injectedDatabase(target, async (statements) => { await target.batch([...statements, target.prepare("INSERT INTO backup_checks(id,matched) VALUES ('injected-run',0)")]); });
  await assert.rejects(start(midFailure), /storage_failure/);
  assert.equal(await target.prepare("SELECT count(*) AS n FROM restore_runs").first<number>("n"), 0);
  assert.equal(await target.prepare("SELECT consumed_at FROM restore_challenges WHERE id=?").bind(challengeId).first<number>("consumed_at"), null);
  checks.push("zero-row consumption and late batch failure both roll back nonce and run together");

  const run = await start(loseCommittedResponse(target)); assert.equal(run.state, "receiving"); assert.equal(run.authorization.restoredExecutionAuthority, "none");
  assert.deepEqual(await start(target), run); assert.deepEqual(await readRestoreRun(target, targetBucket, targetContext, targetContext.owner, runId), run);
  await assert.rejects(startRestoreRun(target, targetBucket, targetContext, targetContext.owner, trust, approval.token, crypto.randomUUID(), challengeId, backupId, approval.manifestSha256, 1500), /wrong-challenge/);
  await assert.rejects(target.prepare("UPDATE restore_challenges SET consumed_at=NULL,consumed_run_id=NULL WHERE id=?").bind(challengeId).run(), /immutable_restore_challenge/);
  await assert.rejects(readRestoreRun(target, targetBucket, targetContext, sourceContext.owner, runId), /wrong-owner/);
  assert.equal(await target.prepare("SELECT count(*) AS n FROM backup_checks").first<number>("n"), 0);
  checks.push("lost run-start response reconciles exact same run; nonce cannot authorize a second run or be reset; no activation granted");

  const manifestText: string = JSON.stringify(manifest); const manifestKey: string = restoreDocumentKey(runId, "manifest.json");
  const receive = (db: AtomicDatabase, bucket: R2Bucket): ReturnType<typeof receiveRestoreManifest> => receiveRestoreManifest(db, bucket, targetContext, targetContext.owner, runId, manifestText, 2000);
  const coursePath: string = "pages/courses/000000.json"; const coursePage: string | undefined = archivePages.get(coursePath); assert(coursePage);
  const receivePage = (db: AtomicDatabase): ReturnType<typeof receiveRestorePage> => receiveRestorePage(db, targetBucket, targetContext, targetContext.owner, runId, coursePath, coursePage, 2100);
  await assert.rejects(receiveRestoreManifest(target, targetBucket, targetContext, targetContext.owner, runId, manifestText + " ", 2000), /wrong-backup/);
  await assert.rejects(receivePage(target), /missing-export/);
  assert.equal(await target.prepare("SELECT count(*) AS n FROM restore_archives").first<number>("n"), 0);
  assert.equal(await targetBucket.get(manifestKey), null);
  checks.push("signed raw manifest mismatch and page-before-manifest refused without reservation or object writes");

  const unavailableReceive = bucketWithPut(targetBucket, async () => { throw new Error("network: receiving R2 unavailable"); });
  await assert.rejects(receive(target, unavailableReceive), /receiving R2 unavailable/);
  assert.equal(await target.prepare("SELECT state FROM restore_archives WHERE run_id=?").bind(runId).first<string>("state"), "reserved");
  await target.prepare("CREATE TRIGGER archive_update_zero BEFORE UPDATE ON restore_archives BEGIN SELECT RAISE(IGNORE); END").run();
  await assert.rejects(receive(target, targetBucket), /storage_failure/);
  assert.equal(await target.prepare("SELECT state FROM restore_archives WHERE run_id=?").bind(runId).first<string>("state"), "reserved");
  assert(await targetBucket.head(manifestKey)); await target.prepare("DROP TRIGGER archive_update_zero").run();
  const archived = await receive(loseCommittedResponse(target), targetBucket);
  assert.deepEqual(await receive(target, targetBucket), archived);
  assert.equal(archived.reservedBytes, Buffer.byteLength(manifestText) + 3072 + manifest.pages.reduce((n, entry) => n + entry.bytes, 0));
  assert.equal((await readRestoreManifest(target, targetBucket, targetContext, targetContext.owner, runId)).receipt.objectVersion, archived.objectVersion);
  await assert.rejects(target.prepare("UPDATE restore_archives SET reserved_bytes=reserved_bytes-1 WHERE run_id=?").bind(runId).run(), /immutable_restore_archive/);
  checks.push("R2 failure and zero-row archive update keep reservation; lost DB response resumes same hash/version and fixed total capacity");

  await assert.rejects(receiveRestorePage(target, targetBucket, targetContext, targetContext.owner, runId, "pages/courses/000001.json", coursePage, 2100), /undeclared-page/);
  await assert.rejects(receiveRestorePage(target, targetBucket, targetContext, targetContext.owner, runId, coursePath, coursePage + " ", 2100), /page-manifest/);
  await target.prepare("CREATE TRIGGER page_insert_zero BEFORE INSERT ON restore_page_receipts BEGIN SELECT RAISE(IGNORE); END").run();
  await assert.rejects(receivePage(target), /storage_failure/);
  assert.equal(await target.prepare("SELECT count(*) AS n FROM restore_page_receipts").first<number>("n"), 0);
  assert(await targetBucket.head(restoreDocumentKey(runId, coursePath)));
  await target.prepare("DROP TRIGGER page_insert_zero").run();
  const pageMidFailure = injectedDatabase(target, async (statements) => { await target.batch([...statements, target.prepare("INSERT INTO backup_checks(id,matched) VALUES ('injected-page',0)")]); });
  await assert.rejects(receivePage(pageMidFailure), /storage_failure/);
  assert.equal(await target.prepare("SELECT count(*) AS n FROM restore_page_receipts").first<number>("n"), 0);
  const receivedPage = await receivePage(loseCommittedResponse(target));
  assert.deepEqual(await receivePage(target), receivedPage);
  checks.push("undeclared/corrupt pages refused; zero-row and late batch errors roll back receipt, saved R2 page resumes after lost response");

  for (const [path, text] of archivePages) await receiveRestorePage(target, targetBucket, targetContext, targetContext.owner, runId, path, text, 2200);
  assert.equal(await target.prepare("SELECT count(*) AS n FROM restore_page_receipts").first<number>("n"), manifest.pages.length);
  assert.equal(await target.prepare("SELECT count(*) AS n FROM courses").first<number>("n"), 0);
  assert.equal((await readRestoreRun(target, targetBucket, targetContext, targetContext.owner, runId)).state, "receiving");
  assert.equal(await target.prepare("SELECT count(*) AS n FROM backup_checks").first<number>("n"), 0);
  await assert.rejects(target.prepare("DELETE FROM restore_page_receipts WHERE run_id=?").bind(runId).run(), /immutable_restore_page_receipt/);
  await targetBucket.put(restoreDocumentKey(runId, coursePath), coursePage);
  await assert.rejects(receivePage(target), /page-receipt/);
  await targetBucket.put(manifestKey, manifestText);
  await assert.rejects(readRestoreManifest(target, targetBucket, targetContext, targetContext.owner, runId), /manifest-version/);
  checks.push("all 92 table pages staged with immutable receipts; same-byte object replacement detected; no business rows loaded or activation granted");

  await assert.rejects(target.prepare("UPDATE restore_storage SET identity='{}' WHERE slot=1").run(), /immutable_restore_storage/);
  await assert.rejects(target.prepare("DELETE FROM restore_storage").run(), /immutable_restore_storage/);
  const saved = await targetBucket.get(storageMarkerKey); assert(saved); const markerText: string = await saved.text();
  await targetBucket.put(storageMarkerKey, markerText);
  await assert.rejects(readRegisteredStorage(target, targetBucket, targetContext, targetContext.owner, "restore-test"), /registration-marker/);
  await targetBucket.delete(storageMarkerKey);
  await assert.rejects(registerRestoreStorage(target, targetBucket, targetContext, targetContext.owner, source.identity, 500), /registration-marker/);
  assert.equal(await targetBucket.get(storageMarkerKey), null);
  checks.push("registered identity immutable; replaced or missing R2 marker blocks use and is never silently recreated");

  const result = { status: "passed", checks, count: checks.length, environment: "local Miniflare D1/R2; all current migrations", authority: "registered storage and authorized receiving run; no activation", actualRestore: "not performed", newAiCalls: 0, newGoogleCalls: 0 };
  await writeFile(".taskmaster/reports/task-17-restore-storage-local.json", JSON.stringify(result, null, 2) + "\n"); console.log(JSON.stringify(result));
} finally { await runtime.dispose(); }
