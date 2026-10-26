import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "vite";
import { Miniflare } from "miniflare";
import { readablePdf } from "../tests/fixtures/pdf-bytes.ts";
import { backupCatalog } from "../lib/backup/catalog.ts";
import type { BackupManifest, BackupRow } from "../lib/backup/contracts.ts";
import type { EncodedBackupPage } from "../lib/backup/pagination.ts";
import type { BackupObjectList } from "../db/repositories/backup-objects.ts";
import { restorePageOrder } from "../lib/backup/restore-order.ts";
import { projectRestoreRow, restoreUploadReference } from "../lib/backup/restore-projection.ts";
import type { RestoreObjectMapping } from "../lib/backup/restore-projection.ts";

export async function checkRestoreImport(chooseTargetOwner: (sourceOwner: string) => string, reportPath: string): Promise<void> {
  const output: string = path.resolve(".sites-runtime/restore-import");
  await build({ configFile: false, logLevel: "warn", plugins: [{ name: "extraction-test-wasm", enforce: "pre", resolveId(source: string) { if (source.endsWith(".wasm")) return { id: `./${path.basename(source)}`, external: true }; return null; } }], ssr: { noExternal: true, external: ["node:buffer", "node:crypto", "node:stream", "node:stream/promises", "node:zlib"], target: "webworker" }, build: { ssr: "tests/fixtures/restore-import-worker.ts", target: "es2022", outDir: output, emptyOutDir: true, rollupOptions: { output: { entryFileNames: "worker.mjs" } } } });
  await copyFile("lib/materials/pdf-wasm/validator.wasm", path.join(output, "validator.wasm")); await copyFile("lib/materials/jpeg-wasm/decoder.wasm", path.join(output, "decoder.wasm"));
  const runtime = new Miniflare({ modules: true, modulesRules: [{ type: "CompiledWasm", include: ["**/*.wasm"], fallthrough: true }], scriptPath: path.join(output, "worker.mjs"), compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"], d1Databases: ["DB", "TARGET"], r2Buckets: ["BUCKET", "TARGET_BUCKET", "STRESS_BUCKET"], d1Persist: false, r2Persist: false, cf: false });
  const backupId: string = crypto.randomUUID(); const runId: string = crypto.randomUUID(); let targetOwner: string = ""; const checks: string[] = []; const pages: EncodedBackupPage[] = [];
  let owner: string = "";
  type HttpResponse = Awaited<ReturnType<Miniflare["dispatchFetch"]>>;
  function url(route: string, query: Readonly<Record<string, string>>): string { return `https://local.invalid/${route}?${new URLSearchParams(query)}`; }
  async function ok(response: HttpResponse): Promise<void> { assert.equal(response.status, 200, response.status === 200 ? undefined : await response.text()); }
  async function source(route: string, query: Readonly<Record<string, string>>, body: unknown): Promise<HttpResponse> { return runtime.dispatchFetch(url(route, { owner, id: backupId, ...query }), { method: "POST", headers: { "content-type": "application/json" }, body: body === null ? undefined : JSON.stringify(body) }); }
  async function target(route: string, query: Readonly<Record<string, string>>): Promise<HttpResponse> { return runtime.dispatchFetch(url(route, { id: runId, targetOwner, ...query }), { method: "POST" }); }
  try {
    const db = await runtime.getD1Database("DB"); const restored = await runtime.getD1Database("TARGET"); const bucket = await runtime.getR2Bucket("TARGET_BUCKET");
    const journal: Readonly<{ entries: readonly Readonly<{ tag: string }>[] }> = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
    for (const entry of journal.entries) for (const statement of (await readFile(`drizzle/${entry.tag}.sql`, "utf8")).split("--> statement-breakpoint").map(part => part.trim()).filter(Boolean)) for (const database of [db, restored]) await database.prepare(statement).run();
    const input: Uint8Array = readablePdf(1);
    const seeded = await runtime.dispatchFetch(url("learning-seed", {}), { method: "PUT", body: input, headers: { "content-type": "application/pdf", "x-fixture-kind": "pdf", "x-fixture-edition": "fixture-v1", "x-fixture-filename": "pages.pdf", "x-fixture-bytes": String(input.length), "x-fixture-sha256": createHash("sha256").update(input).digest("hex") } });
    await ok(seeded); console.log("historical learning fixture seeded");
    const selected = await db.prepare("SELECT owner_id FROM weekly_snapshots LIMIT 1").first<string>("owner_id"); assert(selected); owner = selected; targetOwner = chooseTargetOwner(owner);
    await ok(await source("restore/seed-uncertain", {}, null));
    await ok(await source("restore/budget-fixture", { businessKey: "older-backup-reservation", usdMicros: "1000" }, null));
    await ok(await source("start", {}, null));
    for (const table of backupCatalog) for (let ordinal: number = 0; ; ordinal += 1) { const response = await source("page", { table: table.name, ordinal: String(ordinal) }, null); await ok(response); const page = await response.json() as EncodedBackupPage; pages.push(page); await ok(await source("page-received", { table: table.name, ordinal: String(ordinal) }, page.entry)); if (page.page.final) break; }
    await ok(await source("database", {}, null)); const objectResponse = await source("objects", { offset: "0" }, null); await ok(objectResponse); const objectList = await objectResponse.json() as BackupObjectList;
    const originals: ArrayBuffer[] = [];
    for (const [ordinal, entry] of objectList.entries.entries()) { const response = await source("object", { ordinal: String(ordinal) }, null); await ok(response); originals.push(await response.arrayBuffer()); await ok(await source("object-received", { ordinal: String(ordinal) }, { bytes: entry.bytes, sha256: entry.sha256 })); }
    const complete = await source("complete", {}, null); await ok(complete); const manifest = await complete.json() as BackupManifest;
    await ok(await target("restore/init", { backupId, owner }));
    await ok(await source("restore/budget-fixture", { businessKey: "newer-source-reservation", usdMicros: "2000" }, null));
    const sourceBudget = (await db.prepare("SELECT r.*,f.snapshot FROM cost_reservations r JOIN ai_funding_checks f ON f.owner_id=r.owner_id AND f.reservation_id=r.id WHERE r.owner_id=? ORDER BY r.id").bind(owner).all()).results;
    assert(sourceBudget.some(row => row.request_business_key === "newer-source-reservation" && row.state === "unknown"));
    assert.equal((await target("restore/import", {})).status, 409);
    for (const page of pages) await ok(await runtime.dispatchFetch(url("restore/page", { id: runId, targetOwner, path: page.entry.path }), { method: "PUT", body: page.json }));
    assert.equal((await target("restore/import", {})).status, 409);
    for (const [ordinal, entry] of manifest.objects.entries()) {
      const upload = pages.find(page => page.page.table === "uploads" && page.page.rows.some(row => row.id === entry.uploadId)); const transfer = pages.find(page => page.page.table === "material_transfers" && page.page.rows.some(row => row.id === entry.uploadId)); assert(upload && transfer);
      await ok(await runtime.dispatchFetch(url("restore/original", { id: runId, targetOwner, ordinal: String(ordinal), uploadPage: String(upload.page.ordinal), transferPage: String(transfer.page.ordinal) }), { method: "PUT", headers: { "content-type": "application/octet-stream", "content-length": String(entry.bytes) }, body: originals[ordinal] }));
    }
    assert.equal((await target("restore/import", { owner: "unverified-owner" })).status, 409);
    await restored.prepare("CREATE TRIGGER import_start_zero BEFORE UPDATE ON restore_runs BEGIN SELECT RAISE(IGNORE); END").run();
    assert.equal((await target("restore/import", {})).status, 409); assert.equal(await restored.prepare("SELECT count(*) AS n FROM restore_imports").first<number>("n"), 0);
    await restored.prepare("DROP TRIGGER import_start_zero").run();
    await ok(await target("restore/import", { fault: "lost-response" })); await ok(await target("restore/import", {}));
    checks.push("missing pages/originals and wrong owner denied; zero-row start rolls back; committed start response reconciled");
    assert.equal((await target("restore/verify", {})).status, 409);
    const ordered = restorePageOrder(manifest); assert.equal((await target("restore/import-page", { path: ordered[1].path })).status, 409);
    const firstNonempty = ordered.find(entry => entry.count > 0); assert(firstNonempty); const coursePage = ordered.find(entry => entry.table === "courses" && entry.count > 0); assert(coursePage);
    for (const entry of ordered) {
      if (entry.path === firstNonempty.path) {
        const before = await restored.prepare("SELECT loaded_pages FROM restore_imports").first<number>("loaded_pages");
        assert.equal((await target("restore/import-page", { path: entry.path, fault: "rollback" })).status, 409);
        assert.equal(await restored.prepare("SELECT loaded_pages FROM restore_imports").first<number>("loaded_pages"), before);
        assert.equal(await restored.prepare("SELECT count(*) AS n FROM restore_import_scopes").first<number>("n"), 0);
        await restored.prepare("CREATE TRIGGER import_update_zero BEFORE UPDATE ON restore_imports BEGIN SELECT RAISE(IGNORE); END").run();
        assert.equal((await target("restore/import-page", { path: entry.path })).status, 409); await restored.prepare("DROP TRIGGER import_update_zero").run();
        await restored.prepare("CREATE TRIGGER import_scope_zero BEFORE DELETE ON restore_import_scopes BEGIN SELECT RAISE(IGNORE); END").run();
        assert.equal((await target("restore/import-page", { path: entry.path })).status, 409); await restored.prepare("DROP TRIGGER import_scope_zero").run();
        assert.equal(await restored.prepare("SELECT count(*) AS n FROM restore_import_scopes").first<number>("n"), 0);
        await ok(await target("restore/import-page", { path: entry.path, fault: "lost-response" }));
      } else if (entry.path === coursePage.path) {
        await restored.prepare("CREATE TRIGGER import_row_zero BEFORE INSERT ON courses BEGIN SELECT RAISE(IGNORE); END").run();
        assert.equal((await target("restore/import-page", { path: entry.path })).status, 409); await restored.prepare("DROP TRIGGER import_row_zero").run();
        const concurrent = await Promise.all([0, 1].map(async () => { const response = await target("restore/import-page", { path: entry.path }); const text: string = await response.text(); assert.equal(response.status, 200, text); return JSON.parse(text) as unknown; })); assert.deepEqual(concurrent[0], concurrent[1]);
      } else await ok(await target("restore/import-page", { path: entry.path }));
    }
    checks.push("dependency order enforced; page rollback, zero-row progress/record insert, duplicate concurrency and lost response cannot leave partial imports or temporary exception scopes");
    const mappings = new Map<string, RestoreObjectMapping>();
    for (const entry of manifest.objects) { const object = await bucket.head(entry.objectKey); assert(object); mappings.set(entry.uploadId, { entry, objectVersion: object.version, etag: object.etag }); }
    let restoredRows: number = 0;
    for (const table of backupCatalog) {
      const rows = (await restored.prepare(`SELECT ${table.columns.map(column => `"${column.name}"`).join(",")} FROM "${table.name}"`).all<BackupRow>()).results;
      assert.equal(rows.length, manifest.counts.find(count => count.table === table.name)?.rows, table.name); restoredRows += rows.length;
      const expected = pages.filter(page => page.page.table === table.name).flatMap(page => page.page.rows.map(row => projectRestoreRow(table.name, row, owner, targetOwner, mappings.get(restoreUploadReference(table.name, row) ?? "") ?? null)));
      const key = (row: BackupRow): string => JSON.stringify(table.primaryKey.map(column => row[column]));
      assert.deepEqual(rows.toSorted((a, b) => key(a).localeCompare(key(b))), expected.toSorted((a, b) => key(a).localeCompare(key(b))), table.name);
    }
    assert(restoredRows > 200); assert.equal((await restored.prepare("PRAGMA foreign_key_check").all()).results.length, 0);
    for (const table of ["google_tokens", "google_runtime", "google_oauth_attempts", "restore_import_scopes"]) assert.equal(await restored.prepare(`SELECT count(*) AS n FROM "${table}"`).first<number>("n"), 0, table);
    assert.equal(await restored.prepare("SELECT state FROM restore_runs").first<string>("state"), "verifying");
    assert.equal(await restored.prepare("SELECT loaded_pages FROM restore_imports").first<number>("loaded_pages"), ordered.length);
    const ai = await restored.prepare("SELECT * FROM ai_calls LIMIT 1").first<BackupRow>(); assert(ai);
    await assert.rejects(restored.prepare(`INSERT INTO ai_calls(${Object.keys(ai).join(",")}) VALUES (${Object.keys(ai).map(() => "?").join(",")})`).bind(...Object.values(ai)).run(), /restore_current_execution_unverified/);
    await ok(await target("restore/import-page", { path: coursePage.path }));
    await restored.prepare("UPDATE courses SET title='fixture tampered title' WHERE owner_id=?").bind(targetOwner).run();
    assert.equal((await target("restore/import-page", { path: coursePage.path })).status, 409);
    const originalCourse = pages.find(page => page.entry.path === coursePage.path)!.page.rows[0];
    for (const row of pages.filter(page => page.page.table === "courses").flatMap(page => page.page.rows)) await restored.prepare("UPDATE courses SET title=? WHERE owner_id=? AND id=?").bind(row.title, targetOwner, row.id).run();
    assert.equal((await target("restore/verify", { owner: "unverified-owner" })).status, 409);
    await restored.prepare("CREATE TRIGGER verification_start_zero BEFORE INSERT ON restore_verifications BEGIN SELECT RAISE(IGNORE); END").run();
    assert.equal((await target("restore/verify", {})).status, 409); await restored.prepare("DROP TRIGGER verification_start_zero").run();
    await ok(await target("restore/verify", { fault: "lost-response" })); await ok(await target("restore/verify", {}));
    assert.equal((await target("restore/verify-complete", {})).status, 409);
    const verifyPath: string = ordered[0].path;
    await restored.prepare("CREATE TRIGGER verification_item_zero BEFORE INSERT ON restore_verification_items BEGIN SELECT RAISE(IGNORE); END").run();
    assert.equal((await target("restore/verify-page", { path: verifyPath })).status, 409); await restored.prepare("DROP TRIGGER verification_item_zero").run();
    await restored.prepare("CREATE TRIGGER verification_race BEFORE INSERT ON restore_verification_items BEGIN UPDATE courses SET title='fixture verification race'; END").run();
    assert.equal((await target("restore/verify-page", { path: verifyPath })).status, 409); await restored.prepare("DROP TRIGGER verification_race").run();
    assert.equal(await restored.prepare("SELECT title FROM courses WHERE owner_id=? AND id=?").bind(targetOwner, originalCourse.id).first<string>("title"), originalCourse.title);
    assert.equal(await restored.prepare("SELECT count(*) AS n FROM restore_verification_items").first<number>("n"), 0);
    assert.equal((await target("restore/verify-page", { path: verifyPath, fault: "rollback" })).status, 409);
    await ok(await target("restore/verify-page", { path: verifyPath, fault: "lost-response" }));
    for (const entry of ordered) await ok(await target("restore/verify-page", { path: entry.path }));
    assert.equal((await target("restore/verify-complete", {})).status, 409);
    for (const [ordinal] of manifest.objects.entries()) await ok(await target("restore/verify-original", { ordinal: String(ordinal) }));
    assert.equal((await target("restore/verify-complete", { fault: "rollback" })).status, 409);
    for (const table of ["restore_verifications", "restore_runs"]) {
      await restored.prepare(`CREATE TRIGGER verification_final_zero BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(IGNORE); END`).run();
      assert.equal((await target("restore/verify-complete", {})).status, 409); await restored.prepare("DROP TRIGGER verification_final_zero").run();
      assert.equal(await restored.prepare("SELECT completed_at FROM restore_verifications").first<number | null>("completed_at"), null);
      assert.equal(await restored.prepare("SELECT state FROM restore_runs").first<string>("state"), "verifying");
    }
    for (const table of ["restore_verifications", "restore_runs"]) {
      await restored.prepare(`CREATE TRIGGER verification_final_race AFTER UPDATE ON ${table} BEGIN UPDATE courses SET title='fixture final race'; END`).run();
      assert.equal((await target("restore/verify-complete", {})).status, 409); await restored.prepare("DROP TRIGGER verification_final_race").run();
      assert.equal(await restored.prepare("SELECT completed_at FROM restore_verifications").first<number | null>("completed_at"), null);
      assert.equal(await restored.prepare("SELECT title FROM courses WHERE owner_id=? AND id=?").bind(targetOwner, originalCourse.id).first<string>("title"), originalCourse.title);
    }
    await ok(await target("restore/verify-complete", { fault: "lost-response" })); await ok(await target("restore/verify-complete", {}));
    assert.equal(await restored.prepare("SELECT state FROM restore_runs").first<string>("state"), "verified");
    assert.equal(await restored.prepare("SELECT count(*) AS n FROM restore_verification_items").first<number>("n"), ordered.length + manifest.objects.length);
    await assert.rejects(restored.prepare("UPDATE restore_verification_items SET sha256=?").bind("0".repeat(64)).run(), /immutable_restore_verification_item/);
    checks.push("verification binds all page contents and embedded learning references plus streamed original hashes to one fixed DB revision; zero-row start/item/final updates, mid-verification mutation, late failure and lost-response recovery checked");
    assert.equal((await target("restore/activate", { owner: "unverified-owner" })).status, 409);
    const verifiedRevision = await restored.prepare("SELECT revision FROM backup_revisions WHERE owner_id=?").bind(targetOwner).first<number>("revision");
    assert.equal((await (await target("restore/access", {})).json() as { learning: string }).learning, "quarantined");
    await restored.prepare("UPDATE backup_revisions SET revision=revision+1 WHERE owner_id=?").bind(targetOwner).run();
    assert.equal((await target("restore/activate", {})).status, 409);
    await restored.prepare("UPDATE backup_revisions SET revision=? WHERE owner_id=?").bind(verifiedRevision, targetOwner).run();
    assert.equal((await target("restore/activate", { fault: "rollback" })).status, 409);
    for (const statement of ["BEFORE INSERT ON restore_activations", "BEFORE UPDATE OF state ON restore_runs WHEN NEW.state='activated'"]) {
      await restored.prepare(`CREATE TRIGGER activation_zero ${statement} BEGIN SELECT RAISE(IGNORE); END`).run();
      assert.equal((await target("restore/activate", {})).status, 409); await restored.prepare("DROP TRIGGER activation_zero").run();
      assert.equal(await restored.prepare("SELECT count(*) AS n FROM restore_activations").first<number>("n"), 0);
    }
    for (const statement of ["AFTER INSERT ON restore_activations", "AFTER UPDATE OF state ON restore_runs WHEN NEW.state='activated'"]) {
      await restored.prepare(`CREATE TRIGGER activation_race ${statement} BEGIN UPDATE courses SET title='activation-race'; END`).run();
      assert.equal((await target("restore/activate", {})).status, 409); await restored.prepare("DROP TRIGGER activation_race").run();
      assert.equal(await restored.prepare("SELECT count(*) AS n FROM restore_activations").first<number>("n"), 0);
      assert.equal(await restored.prepare("SELECT title FROM courses WHERE owner_id=? AND id=?").bind(targetOwner, originalCourse.id).first<string>("title"), originalCourse.title);
    }
    for (const response of await Promise.all([target("restore/activate", { fault: "lost-response" }), target("restore/activate", {})])) await ok(response); await ok(await target("restore/activate", {}));
    assert.equal(await restored.prepare("SELECT state FROM restore_runs").first<string>("state"), "activated");
    const active = await (await target("restore/access", {})).json() as { learning: string; externalAuthority: string };
    await ok(await target("restore/dashboard", {})); await ok(await target("restore/usage", {}));
    assert.equal(active.learning, "active"); assert.equal(active.externalAuthority, "unverified");
    assert.equal((await target("restore/execution", {})).status, 409);
    assert.equal((await (await target("restore/access", {owner: "unverified-owner"})).json() as {learning: string}).learning, "quarantined");
    await assert.rejects(restored.prepare("DELETE FROM restore_activations").run(), /immutable_restore_activation/);
    await assert.rejects(restored.prepare("UPDATE restore_activations SET external_authority='verified'").run(), /immutable_restore_activation/);
    for (const [table, field] of [["cost_windows", "limit_units"], ["cost_reservations", "amount_units"], ["ai_calls", "stage"], ["external_jobs", "state"], ["external_operations", "state"], ["google_requests", "state"]]) {
      if (await restored.prepare(`SELECT count(*) AS n FROM ${table}`).first<number>("n") === 0) continue;
      await assert.rejects(restored.prepare(`UPDATE ${table} SET ${field}=${field}`).run(), /restore_current_execution_unverified/);
    }
    await restored.prepare("UPDATE courses SET title='new manual learning after activation' WHERE owner_id=?").bind(targetOwner).run();
    assert.equal((await (await target("restore/access", {})).json() as {learning: string}).learning, "active");
    await ok(await target("restore/activate", {})); assert.equal((await target("restore/execution", {})).status, 409);
    checks.push("activation requires verified unchanged revision and current original versions; foreign owner, stale revision, zero-row insert/update, concurrent mutation and late rollback refused; lost response replay preserves receipt");
    checks.push("activated target permits new learning while durable current budget and external execution remain unverified; historical ledger mutations and ordinary execution are blocked; owner mismatch remains quarantined");
    checks.push("all 92 table counts and every exported column match documented projection; foreign keys pass; changed replay rows refused; current execution cannot be granted by old budget or expired leases");
    const consent = await target("restore/consent-check", {}); await ok(consent);
    const consentProof = await consent.json() as { checks: readonly string[]; mockedOAuthRequests: number; liveProviderRequests: number };
    assert.equal(consentProof.mockedOAuthRequests, 2); assert.equal(consentProof.liveProviderRequests, 0);
    checks.push(...consentProof.checks);
    assert.equal((await target("restore/execution", {})).status, 409);
    assert.deepEqual((await db.prepare("SELECT r.*,f.snapshot FROM cost_reservations r JOIN ai_funding_checks f ON f.owner_id=r.owner_id AND f.reservation_id=r.id WHERE r.owner_id=? ORDER BY r.id").bind(owner).all()).results, sourceBudget);
    const oldReservation = await restored.prepare("SELECT r.state,f.snapshot FROM cost_reservations r JOIN ai_funding_checks f ON f.owner_id=r.owner_id AND f.reservation_id=r.id WHERE r.owner_id=? AND r.request_business_key='older-backup-reservation'").bind(targetOwner).first<{ state: string; snapshot: string }>(); assert(oldReservation);
    assert.equal(oldReservation.state, "unknown");
    const pending = JSON.parse(oldReservation.snapshot) as { reservationUsdMicros: number; prepaidProbe: { pendingPayment: { krwStatus: string; reservedKrwUnits: number } } };
    assert.equal(pending.reservationUsdMicros, 1000); assert.equal(pending.prepaidProbe.pendingPayment.krwStatus, "pending"); assert.equal(pending.prepaidProbe.pendingPayment.reservedKrwUnits, 10_000_000_000);
    assert.equal(await restored.prepare("SELECT count(*) AS n FROM cost_reservations WHERE request_business_key='newer-source-reservation'").first<number>("n"), 0);
    checks.push("older backup keeps unknown USD reservation and pending KRW 10000 payment as history; newer source USD reservation stays unchanged; restored current balance remains unverified and does not grant spending");
    const report = { ownerMapping: owner === targetOwner ? "same-confirmed-owner" : "different-confirmed-owner", googleConsent: consentProof, status: "passed", checks, count: checks.length, tables: backupCatalog.length, pages: ordered.length, restoredRows, originals: manifest.objects.length, environment: "local workerd with real D1/R2; production learning functions plus mock provider fixture; all migrations", actualHostedRestore: "not-performed", verification: "passed; stale revision refuses activation", activation: "local learning activated; external execution blocked pending current authority reconciliation", liveAiCalls: 0, liveGoogleCalls: 0 };
    await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report));
  } finally { await runtime.dispose(); }
}
