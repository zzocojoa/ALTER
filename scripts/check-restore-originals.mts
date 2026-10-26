import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "vite";
import { Miniflare } from "miniflare";
import { backupCatalog } from "../lib/backup/catalog.ts";
import type { BackupManifest } from "../lib/backup/contracts.ts";
import type { EncodedBackupPage } from "../lib/backup/pagination.ts";
import type { BackupObjectList } from "../db/repositories/backup-objects.ts";
import type { RestoredOriginalReceipt } from "../db/repositories/restore-originals.ts";
import type { CheckedStreamProof } from "../lib/materials/checked-stream.ts";

const output: string = path.resolve(".sites-runtime/restore-originals");
await build({ configFile: false, logLevel: "warn", ssr: { noExternal: true, external: ["node:crypto"], target: "webworker" }, build: { ssr: "tests/fixtures/restore-original-worker.ts", target: "es2022", outDir: output, emptyOutDir: true, rollupOptions: { output: { entryFileNames: "worker.mjs" } } } });
const runtime: Miniflare = new Miniflare({ modules: true, scriptPath: path.join(output, "worker.mjs"), compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"], d1Databases: ["DB", "TARGET"], r2Buckets: ["BUCKET", "TARGET_BUCKET", "STRESS_BUCKET"], d1Persist: false, r2Persist: false, cf: false });
const checks: string[] = []; const owner: string = "backup-worker-owner"; const backupId: string = crypto.randomUUID(); const runId: string = crypto.randomUUID();
const pages: EncodedBackupPage[] = [];
type HttpResponse = Awaited<ReturnType<Miniflare["dispatchFetch"]>>;
async function* bytes(length: number, value: number): AsyncGenerator<Uint8Array> { for (let i: number = 0; i < length; i += 65536) yield new Uint8Array(Math.min(65536, length - i)).fill(value); }
function hash(length: number): string { const digest = createHash("sha256"); for (let i: number = 0; i < length; i += 65536) digest.update(new Uint8Array(Math.min(65536, length - i)).fill(97)); return digest.digest("hex"); }
function url(route: string, query: Readonly<Record<string, string>>): string { return `https://local.invalid/${route}?${new URLSearchParams(query)}`; }
async function ok(response: HttpResponse): Promise<void> { assert.equal(response.status, 200, response.status === 200 ? undefined : await response.text()); }
async function source(route: string, query: Readonly<Record<string, string>>, body: unknown): Promise<HttpResponse> { return runtime.dispatchFetch(url(route, { owner, id: backupId, ...query }), { method: "POST", headers: { "content-type": "application/json" }, body: body === null ? undefined : JSON.stringify(body) }); }
async function send(ordinal: number, fault: string, value: number, caller: string): Promise<HttpResponse> {
  return runtime.dispatchFetch(url("restore/original", { id: runId, ordinal: String(ordinal), uploadPage: "0", transferPage: "0", fault, owner: caller }), { method: "PUT", headers: { "content-type": "application/octet-stream", "content-length": "900000" }, body: bytes(900000, value), duplex: "half" });
}
try {
  const db = await runtime.getD1Database("DB"); const target = await runtime.getD1Database("TARGET"); const bucket = await runtime.getR2Bucket("TARGET_BUCKET");
  const journal: Readonly<{ entries: readonly Readonly<{ tag: string }>[] }> = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
  for (const entry of journal.entries) for (const statement of (await readFile(`drizzle/${entry.tag}.sql`, "utf8")).split("--> statement-breakpoint").map(part => part.trim()).filter(Boolean)) for (const database of [db, target]) await database.prepare(statement).run();
  for (let i: number = 0; i < 3; i += 1) await ok(await runtime.dispatchFetch(url("seed", { owner }), { method: "PUT", headers: { "x-bytes": "900000", "x-sha256": hash(900000) }, body: bytes(900000, 97), duplex: "half" }));
  await ok(await source("start", {}, null));
  for (const table of backupCatalog) for (let ordinal: number = 0; ; ordinal += 1) { const response = await source("page", { table: table.name, ordinal: String(ordinal) }, null); await ok(response); const page = await response.json() as EncodedBackupPage; pages.push(page); await ok(await source("page-received", { table: table.name, ordinal: String(ordinal) }, page.entry)); if (page.page.final) break; }
  await ok(await source("database", {}, null)); const objectsResponse = await source("objects", { offset: "0" }, null); await ok(objectsResponse); const objects = await objectsResponse.json() as BackupObjectList;
  for (const [ordinal, entry] of objects.entries.entries()) {
    const body = await source("object", { ordinal: String(ordinal) }, null); await ok(body); await body.arrayBuffer();
    await ok(await source("object-received", { ordinal: String(ordinal) }, { bytes: entry.bytes, sha256: entry.sha256 }));
  }
  const complete = await source("complete", {}, null); await ok(complete); const manifest = await complete.json() as BackupManifest;
  await ok(await runtime.dispatchFetch(url("restore/init", { id: runId, backupId }), { method: "POST" }));
  assert.equal((await send(0, "", 97, "other-owner")).status, 409);
  assert.equal((await send(0, "", 97, "restored-worker-owner")).status, 409);
  for (const page of pages) await ok(await runtime.dispatchFetch(url("restore/page", { id: runId, path: page.entry.path }), { method: "PUT", body: page.json }));
  checks.push("actual source uploads and completed export authorize different target owner; missing source pages and unverified owner cannot receive originals");

  assert.equal((await send(0, "put-before", 97, "restored-worker-owner")).status, 409);
  assert.equal(await target.prepare("SELECT state FROM restore_originals WHERE ordinal=0").first<string>("state"), "reserved");
  assert.equal(await bucket.head(manifest.objects[0].objectKey), null);
  assert.equal((await send(0, "", 98, "restored-worker-owner")).status, 409);
  assert.equal(await bucket.head(manifest.objects[0].objectKey), null);
  checks.push("R2 write failure and wrong streamed checksum retain reservation without a completed object or receipt");

  await target.prepare("CREATE TRIGGER original_update_zero BEFORE UPDATE ON restore_originals BEGIN SELECT RAISE(IGNORE); END").run();
  assert.equal((await send(0, "", 97, "restored-worker-owner")).status, 409);
  assert.equal(await target.prepare("SELECT state FROM restore_originals WHERE ordinal=0").first<string>("state"), "reserved");
  assert(await bucket.head(manifest.objects[0].objectKey)); await target.prepare("DROP TRIGGER original_update_zero").run();
  assert.equal((await send(0, "db-late-failure", 97, "restored-worker-owner")).status, 409);
  assert.equal(await target.prepare("SELECT state FROM restore_originals WHERE ordinal=0").first<string>("state"), "reserved");
  const resumed = await send(0, "db-lost-confirm", 97, "restored-worker-owner"); await ok(resumed); const receipt = await resumed.json() as RestoredOriginalReceipt;
  const repeated = await send(0, "", 97, "restored-worker-owner"); await ok(repeated); assert.deepEqual(await repeated.json(), receipt);
  checks.push("UPDATE zero and late batch failure roll back verification; saved object resumes, lost confirmation response preserves same object version");

  const readConcurrent = async (response: HttpResponse): Promise<RestoredOriginalReceipt> => { const text: string = await response.text(); assert.equal(response.status, 200, text); return JSON.parse(text) as RestoredOriginalReceipt; };
  const duplicate = await Promise.all([send(1, "", 97, "restored-worker-owner").then(readConcurrent), send(1, "", 97, "restored-worker-owner").then(readConcurrent)]);
  assert.deepEqual(duplicate[0], duplicate[1]);
  await ok(await send(2, "put-after", 97, "restored-worker-owner"));
  assert.equal(await target.prepare("SELECT count(*) AS n FROM restore_originals WHERE state='verified'").first<number>("n"), 3);
  assert.equal(await target.prepare("SELECT count(*) AS n FROM material_files").first<number>("n"), 0);
  assert.equal(await target.prepare("SELECT state FROM restore_runs").first<string>("state"), "receiving");
  assert.equal(await target.prepare("SELECT count(*) AS n FROM backup_checks").first<number>("n"), 0);
  checks.push("concurrent same original uses one conditional object version; lost R2 completion reconciles by full read/hash; no learning data or execution activated");

  for (const entry of manifest.objects) {
    const restored = await bucket.get(entry.objectKey); assert(restored); const digest = createHash("sha256"); digest.update(new Uint8Array(await restored.arrayBuffer())); assert.equal(digest.digest("hex"), entry.sha256);
    assert.notEqual(restored.version, entry.objectVersion); assert.equal(restored.customMetadata?.alterTransferId, entry.uploadId);
    const uploadId = await db.prepare("SELECT upload_id FROM uploads WHERE id=?").bind(entry.uploadId).first<string>("upload_id"); assert.equal(restored.customMetadata?.alterUploadId, uploadId);
  }
  const before = await bucket.get(manifest.objects[0].objectKey); assert(before);
  await bucket.put(before.key, await before.arrayBuffer(), { httpMetadata: before.httpMetadata, customMetadata: before.customMetadata });
  assert.equal((await send(0, "", 97, "restored-worker-owner")).status, 409);
  await assert.rejects(target.prepare("UPDATE restore_originals SET object_version='changed' WHERE ordinal=1").run(), /immutable_restore_original/);
  await bucket.delete(manifest.objects[1].objectKey);
  assert.equal((await send(1, "", 97, "restored-worker-owner")).status, 409);
  assert.equal(await bucket.head(manifest.objects[1].objectKey), null);
  checks.push("original IDs/custom metadata and exact checksums preserved with explicit new R2 versions; same-byte replacement and receipt rewrites refused; missing verified original never recreated");

  const stress = await runtime.dispatchFetch(url("restore/stress", {}), { method: "PUT", headers: { "x-sha256": hash(160 * 1024 * 1024) }, body: bytes(160 * 1024 * 1024, 97), duplex: "half" }); await ok(stress);
  const stressResult = await stress.json() as { proof: CheckedStreamProof; wholeIsolateMemoryMeasured: boolean; scope: string };
  assert.equal(stressResult.proof.bytes, 160 * 1024 * 1024); assert.equal(stressResult.proof.sha256, hash(160 * 1024 * 1024)); assert(stressResult.proof.maximumReadBytes <= 65536 && stressResult.proof.maximumReadBufferBytes <= 65536);
  checks.push("160MiB stream primitive writes/reads actual local R2 with 64KiB application reads; full isolate peak not measured and product size limits unchanged");
  const report = { status: "passed", checks, count: checks.length, stress: stressResult, environment: "local workerd with real D1/R2 and all migrations; explicit fault injection", actualHostedRestore: "not-performed", restoredBusinessRecords: 0, liveAiCalls: 0, liveGoogleCalls: 0 };
  await writeFile(".taskmaster/reports/task-17-restore-originals-local.json", JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report));
} finally { await runtime.dispose(); }
