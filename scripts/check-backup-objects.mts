import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { preflightBackup } from "./backup/preflight.ts";
import { build } from "vite";
import { Miniflare } from "miniflare";
import { backupCatalog } from "../lib/backup/catalog.ts";
import type { BackupManifest } from "../lib/backup/contracts.ts";
import type { EncodedBackupPage } from "../lib/backup/pagination.ts";
import type { BackupObjectList } from "../db/repositories/backup-objects.ts";

const output: string = path.resolve(".sites-runtime/backup-objects");
await build({ configFile: false, logLevel: "warn", ssr: { noExternal: true, external: ["node:crypto"], target: "webworker" }, build: { ssr: "tests/fixtures/backup-worker.ts", target: "es2022", outDir: output, emptyOutDir: true, rollupOptions: { output: { entryFileNames: "worker.mjs" } } } });
const runtime: Miniflare = new Miniflare({ modules: true, scriptPath: path.join(output, "worker.mjs"), compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"], d1Databases: ["DB"], r2Buckets: ["BUCKET"], d1Persist: false, r2Persist: false, cf: false });
const checks: string[] = [];
const archiveRoot: string = await mkdtemp(path.join(tmpdir(), "alter-backup-archive-"));
type Seed = Readonly<{ materialId: string; transferId: string; uploadId: string; key: string; bytes: number; sha256: string }>;
type SmallResponse = Awaited<ReturnType<Miniflare["dispatchFetch"]>>;
async function* pattern(bytes: number): AsyncGenerator<Uint8Array> { for (let offset: number = 0; offset < bytes; offset += 65536) yield new Uint8Array(Math.min(65536, bytes - offset)).fill(97); }
function expectedHash(bytes: number): string { const digest = createHash("sha256"); for (let offset: number = 0; offset < bytes; offset += 65536) digest.update(new Uint8Array(Math.min(65536, bytes - offset)).fill(97)); return digest.digest("hex"); }
function url(route: string, owner: string, id: string, query: Readonly<Record<string, string>>): string { return `https://local.invalid/${route}?${new URLSearchParams({ owner, id, ...query })}`; }
async function call(route: string, owner: string, id: string, query: Readonly<Record<string, string>>, body: unknown): Promise<SmallResponse> {
  return runtime.dispatchFetch(url(route, owner, id, query), { method: "POST", headers: { "content-type": "application/json" }, body: body === null ? undefined : JSON.stringify(body) });
}
async function requireOk(response: SmallResponse): Promise<void> { if (response.status !== 200) throw new Error(`로컬 백업 검증 HTTP ${response.status}: ${await response.text()}`); }
async function makeSeed(owner: string, bytes: number): Promise<Seed> {
  const response = await runtime.dispatchFetch(url("seed", owner, "", {}), { method: "PUT", headers: { "x-bytes": String(bytes), "x-sha256": expectedHash(bytes) }, body: pattern(bytes), duplex: "half" });
  await requireOk(response); return await response.json() as Seed;
}
async function begin(owner: string): Promise<string> { const id: string = crypto.randomUUID(); await requireOk(await call("start", owner, id, {}, null)); return id; }
async function databaseReady(owner: string, id: string): Promise<void> {
  for (const table of backupCatalog) for (let ordinal: number = 0; ; ordinal += 1) {
    const response = await call("page", owner, id, { table: table.name, ordinal: String(ordinal) }, null); await requireOk(response); const result = await response.json() as EncodedBackupPage;
    assert.equal(createHash("sha256").update(result.json).digest("hex"), result.entry.sha256);
    const destination: string = path.join(archiveRoot, id, result.entry.path); await mkdir(path.dirname(destination), { recursive: true }); await writeFile(destination, result.json);
    await requireOk(await call("page-received", owner, id, { table: table.name, ordinal: String(ordinal) }, { sha256: result.entry.sha256, bytes: result.entry.bytes }));
    if (result.page.final) break;
  }
  await requireOk(await call("database", owner, id, {}, null));
}
async function consume(response: SmallResponse): Promise<Readonly<{ bytes: number; sha256: string }>> {
  await requireOk(response); if (!response.body) throw new Error("원본 스트림 없음");
  const digest = createHash("sha256"); let bytes: number = 0;
  const reader = response.body.getReader();
  try { for (;;) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength; digest.update(next.value); } } finally { reader.releaseLock(); }
  const sha256: string = digest.digest("hex");
  assert.equal(bytes, Number(response.headers.get("x-bytes")), "수신한 원본 크기가 서버 대응표와 다릅니다.");
  assert.equal(sha256, response.headers.get("x-sha256"), "수신한 원본 해시가 서버 대응표와 다릅니다.");
  return { bytes, sha256 };
}
try {
  const db = await runtime.getD1Database("DB"); const bucket = await runtime.getR2Bucket("BUCKET");
  const journal: Readonly<{ entries: readonly Readonly<{ tag: string }>[] }> = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
  for (const entry of journal.entries) for (const statement of (await readFile(`drizzle/${entry.tag}.sql`, "utf8")).split("--> statement-breakpoint").map(part => part.trim()).filter(Boolean)) await db.prepare(statement).run();
  const owner: string = "backup-worker-owner"; const seeds: Seed[] = [];
  for (let i: number = 0; i < 3; i += 1) seeds.push(await makeSeed(owner, 900000));
  const id: string = await begin(owner);
  const notReady = await call("object", owner, id, { ordinal: "0" }, null); assert.equal(notReady.status, 409); assert.equal((await notReady.json() as { code: string }).code, "incomplete-export");
  await databaseReady(owner, id);
  const listing = await call("objects", owner, id, { offset: "0" }, null); await requireOk(listing); const list = await listing.json() as BackupObjectList;
  assert.equal(list.count, 3); assert.deepEqual(list.entries.map(entry => entry.uploadId), seeds.map(seed => seed.transferId));
  assert.equal(list.nextOffset, null); assert(!JSON.stringify(list).includes("multipart"));
  checks.push("JSON pages for all 92 D1 tables are acknowledged before R2 phase; three original mappings match exact source identifiers");
  assert.equal((await call("object", "different-owner", id, { ordinal: "0" }, null)).status, 409);
  assert.equal((await call("complete", owner, id, {}, null)).status, 409);
  checks.push("other owner and incomplete object set cannot produce completed backup");
  const partial = await call("object", owner, id, { ordinal: "0" }, null); await requireOk(partial); if (!partial.body) throw new Error("취소 시험 스트림 없음");
  const cancelled = partial.body.getReader(); await cancelled.read(); await cancelled.cancel("local-client-cancel");
  assert.equal((await call("complete", owner, id, {}, null)).status, 409);
  const receiptCount = await db.prepare("SELECT count(*) AS n FROM backup_objects WHERE owner_id=? AND backup_id=? AND acknowledged_at IS NOT NULL").bind(owner, id).first<{ n: number }>(); assert.equal(receiptCount?.n, 0);
  checks.push("client cancellation never grants received-file authority even if network buffering completed server read");
  for (const [ordinal, seed] of seeds.entries()) {
    const downloaded = await consume(await call("object", owner, id, { ordinal: String(ordinal) }, null));
    assert.equal(downloaded.bytes, seed.bytes); assert.equal(downloaded.sha256, seed.sha256);
    assert.equal((await call("complete", owner, id, {}, null)).status, 409);
    assert.equal((await call("object-received", owner, id, { ordinal: String(ordinal) }, { sha256: "0".repeat(64), bytes: seed.bytes })).status, 409);
    await requireOk(await call("object-received", owner, id, { ordinal: String(ordinal) }, downloaded));
  }
  checks.push("real local R2 bodies match incremental SHA-256; wrong or absent client receipt is rejected");
  // 마지막 페이지 재수신을 시작하면 기존 수신 확인이 해제됩니다.
  const replay = await call("page", owner, id, { table: "courses", ordinal: "0" }, null); await requireOk(replay); const replayPage = await replay.json() as EncodedBackupPage;
  const incompletePage = await call("complete", owner, id, {}, null); assert.equal(incompletePage.status, 409); assert.equal((await incompletePage.json() as { code: string }).code, "incomplete-download");
  await requireOk(await call("page-received", owner, id, { table: "courses", ordinal: "0" }, { sha256: replayPage.entry.sha256, bytes: replayPage.entry.bytes }));
  checks.push("page retransmission clears previous receipt; every page receipt is required for final manifest");
  const completed = await call("complete-lost-response", owner, id, {}, null); await requireOk(completed); const manifest = await completed.json() as BackupManifest;
  assert.equal(manifest.state, "complete"); assert.equal(manifest.objects.length, 3); assert(manifest.pages.length >= 92); assert.equal(manifest.credentials, "excluded"); assert.equal(manifest.executionAuthority, "none");
  await mkdir(path.join(archiveRoot, id, "objects"), { recursive: true });
  for (const [ordinal, seed] of seeds.entries()) {
    const original = await bucket.get(seed.key); assert(original);
    await writeFile(path.join(archiveRoot, id, `objects/${String(ordinal).padStart(6, "0")}.bin`), new Uint8Array(await original.arrayBuffer()));
  }
  await writeFile(path.join(archiveRoot, id, "manifest.json"), JSON.stringify(manifest));
  const preflight = await preflightBackup(path.join(archiveRoot, id)); assert.equal(preflight.status, "passed"); assert.equal(preflight.objects, 3); assert.equal(preflight.targetWrites, 0);
  checks.push("actual exported D1 pages and real local R2 originals pass restore preflight without target writes");
  await db.prepare("UPDATE courses SET title='완료 뒤 새 학습' WHERE owner_id=?").bind(owner).run();
  const retained = await call("completed", owner, id, {}, null); await requireOk(retained); assert.deepEqual(await retained.json(), manifest);
  const repeated = await call("complete", owner, id, {}, null); await requireOk(repeated); assert.deepEqual(await repeated.json(), manifest);
  checks.push("lost final commit response reconciles; immutable manifest replays after later learning changes");

  for (const fault of ["replace", "delete", "database-change"]) {
    const who: string = `backup-fault-${fault}`; await makeSeed(who, 200000); const failing: string = await begin(who); await databaseReady(who, failing);
    const response = await call("object", who, failing, { ordinal: "0", fault }, null); await requireOk(response);
    await assert.rejects(consume(response));
    assert.equal((await db.prepare("SELECT count(*) AS n FROM backup_objects WHERE owner_id=? AND backup_id=?").bind(who, failing).first<{ n: number }>())?.n, 0);
    assert.equal((await call("complete", who, failing, {}, null)).status, 409);
    checks.push(`actual local ${fault} at post-read boundary rejects validated file receipt, object proof, and completion`);
  }
  const missingOwner: string = "backup-missing"; const missingSeed = await makeSeed(missingOwner, 10000); const missing: string = await begin(missingOwner); await databaseReady(missingOwner, missing); await bucket.delete(missingSeed.key);
  assert.equal((await call("object", missingOwner, missing, { ordinal: "0" }, null)).status, 409);
  assert.equal((await call("complete", missingOwner, missing, {}, null)).status, 409);
  checks.push("missing R2 original is explicit failure, not an omitted object");

  const heldOwner: string = "backup-held";
  const heldSeed = await runtime.dispatchFetch(url("hold", heldOwner, "", {}), { method: "PUT", headers: { "x-bytes": "1000", "x-sha256": expectedHash(1000) }, body: pattern(1000), duplex: "half" }); await requireOk(heldSeed);
  const held: string = await begin(heldOwner); const heldList = await call("objects", heldOwner, held, { offset: "0" }, null); assert.equal(heldList.status, 409); assert.equal((await heldList.json() as { code: string }).code, "unsettled-upload");
  checks.push("unresolved upload is retained and blocks complete original mapping");

  const stressBytes: number = 160 * 1024 * 1024;
  const stressed = await runtime.dispatchFetch("https://local.invalid/stress", { method: "PUT", headers: { "x-bytes": String(stressBytes), "x-sha256": expectedHash(stressBytes) }, body: pattern(stressBytes), duplex: "half" });
  await requireOk(stressed); const stress = await stressed.json() as { proofs: { bytes: number; sha256: string; maximumReadBytes: number; maximumReadBufferBytes: number }[]; deleted: boolean; wholeIsolateMemoryMeasured: boolean };
  assert.equal(stress.proofs.length, 2); assert(stress.deleted);
  for (const proof of stress.proofs) { assert.equal(proof.bytes, stressBytes); assert.equal(proof.sha256, expectedHash(stressBytes)); assert(proof.maximumReadBytes <= 65536); assert(proof.maximumReadBufferBytes <= 65536); }
  checks.push("160MiB synthetic file passes real local R2 upload/read using 64KiB application buffers; whole isolate memory not measured");
  const report = { status: "passed", scope: "local workerd D1/R2 plus explicit boundary fault injection", checks, stress, actualSitesR2: "not-yet-performed", liveProviderCalls: 0, additionalResources: 0 };
  await writeFile(".taskmaster/reports/task-17-backup-objects-local.json", JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report));
} finally { await runtime.dispose(); await rm(archiveRoot, { recursive: true, force: false }); }
