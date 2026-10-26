import backupWorker from "./backup-worker.ts";
import { registerPrimaryStorage, registerRestoreStorage } from "../../db/repositories/restore-storage.ts";
import { createRestoreChallenge, startRestoreRun } from "../../db/repositories/restore-run.ts";
import { approveBackupRestore } from "../../db/repositories/restore-approval.ts";
import { readCompletedBackup } from "../../db/repositories/backup-completion.ts";
import { receiveRestoreManifest, receiveRestorePage } from "../../db/repositories/restore-receiving.ts";
import { receiveRestoreOriginal } from "../../db/repositories/restore-originals.ts";
import { restorePublicKeyHash } from "../../lib/backup/restore-authority.ts";
import { restoreOriginalInput } from "../../lib/backup/restore-original.ts";
import { putCheckedRestoreOriginal } from "../../lib/backup/restore-original-stream.ts";
import { createCheckedByteStream } from "../../lib/materials/checked-stream.ts";
import type { CheckedStreamProof } from "../../lib/materials/checked-stream.ts";
import type { AtomicDatabase } from "../../db/repositories/atomic.ts";
import type { StorageContext } from "../../lib/backup/storage-identity.ts";

type Environment = Readonly<{ DB: D1Database; BUCKET: R2Bucket; TARGET: D1Database; TARGET_BUCKET: R2Bucket; STRESS_BUCKET: R2Bucket }>;
const sourceContext: StorageContext = { projectId: "local-backup-project", owner: { realm: "sites", userId: "backup-worker-owner" } };

export async function initializeRestoreFixture(env: Environment, sourceContext: StorageContext, targetContext: StorageContext, backupId: string, id: string): Promise<Response> {
  const source = await registerPrimaryStorage(env.DB, env.BUCKET, sourceContext, sourceContext.owner, Date.now());
  await registerRestoreStorage(env.TARGET, env.TARGET_BUCKET, targetContext, targetContext.owner, source.identity, Date.now());
  const pair: CryptoKeyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const challenge = await createRestoreChallenge(env.TARGET, env.TARGET_BUCKET, targetContext, targetContext.owner, crypto.randomUUID(), Date.now(), Date.now() + 90000);
  const approval = await approveBackupRestore(env.DB, env.BUCKET, sourceContext, sourceContext.owner, pair.privateKey, challenge, backupId, Date.now());
  await startRestoreRun(env.TARGET, env.TARGET_BUCKET, targetContext, targetContext.owner, { source: source.identity, publicKey: pair.publicKey, keySha256: await restorePublicKeyHash(pair.publicKey) }, approval.token, id, challenge.id, backupId, approval.manifestSha256, Date.now());
  const manifest = await readCompletedBackup(env.DB, sourceContext.owner, backupId);
  return Response.json(await receiveRestoreManifest(env.TARGET, env.TARGET_BUCKET, targetContext, targetContext.owner, id, JSON.stringify(manifest), Date.now()));
}
/** 실제 R2 쓰기 전 실패 또는 완료 후 응답 유실만 주입합니다. */
function faultyBucket(bucket: R2Bucket, fault: string): R2Bucket {
  return new Proxy(bucket, { get(target, property) {
    if (property === "put") return async (...args: Parameters<R2Bucket["put"]>): Promise<R2Object | null> => {
      if (fault === "put-before") throw new Error("fixture R2 write unavailable");
      const object = await bucket.put(...args);
      if (fault === "put-after") throw new Error("fixture R2 committed response lost"); return object;
    };
    const value = Reflect.get(target, property, target); return typeof value === "function" ? value.bind(target) : value;
  } });
}
function faultyDatabase(db: D1Database, fault: string): AtomicDatabase {
  let batches: number = 0;
  return { prepare: db.prepare.bind(db), async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    batches += 1;
    if (batches === 2 && fault === "db-late-failure") return db.batch([...statements, db.prepare("INSERT INTO backup_checks(id,matched) VALUES ('original-fault',0)")]);
    const result = await db.batch<T>(statements);
    if (batches === 2 && fault === "db-lost-confirm") throw new Error("network: fixture original confirmed response lost"); return result;
  } };
}
async function stress(request: Request, env: Environment): Promise<Response> {
  if (request.body === null) throw new Error("검증 원본 없음");
  const expected = { bytes: 160 * 1024 * 1024, sha256: request.headers.get("x-sha256") ?? "" }; const key: string = "fixed-stress-original";
  await putCheckedRestoreOriginal(env.STRESS_BUCKET, key, request.body, expected, { onlyIf: { etagDoesNotMatch: "*" } }, request.signal);
  const saved = await env.STRESS_BUCKET.get(key); if (saved === null) throw new Error("검증 원본 저장 실패");
  let proof: CheckedStreamProof | null = null;
  await createCheckedByteStream(saved.body, expected, request.signal, async value => { proof = value; }).pipeTo(new WritableStream<Uint8Array>({ write(): void {} }));
  return Response.json({ proof, wholeIsolateMemoryMeasured: false, scope: "stream primitive; does not expand accepted material size limits" });
}
async function run(request: Request, env: Environment): Promise<Response> {
  const url: URL = new URL(request.url); const id: string = url.searchParams.get("id") ?? "";
  const targetContext: StorageContext = { projectId: "isolated-restore-project", owner: { realm: "sites", userId: url.searchParams.get("targetOwner") ?? "restored-worker-owner" } };
  if (url.pathname === "/restore/init") return initializeRestoreFixture(env, sourceContext, targetContext, url.searchParams.get("backupId") ?? "", id);
  if (url.pathname === "/restore/page") return Response.json(await receiveRestorePage(env.TARGET, env.TARGET_BUCKET, targetContext, targetContext.owner, id, url.searchParams.get("path") ?? "", await request.text(), Date.now()));
  if (url.pathname === "/restore/original") {
    const fault: string = url.searchParams.get("fault") ?? "";
    const input = restoreOriginalInput.parse({ ordinal: Number(url.searchParams.get("ordinal")), uploadPage: Number(url.searchParams.get("uploadPage")), transferPage: Number(url.searchParams.get("transferPage")) });
    return Response.json(await receiveRestoreOriginal(faultyDatabase(env.TARGET, fault), faultyBucket(env.TARGET_BUCKET, fault), targetContext, { realm: "sites", userId: url.searchParams.get("owner") ?? targetContext.owner.userId }, id, input, request, Date.now()));
  }
  if (url.pathname === "/restore/stress") return stress(request, env);
  return backupWorker.fetch(request, env);
}
/** 조기 거절된 합성 업로드만 소진하여 로컬 HTTP 전송 중 응답 종료 경합을 막습니다. */
async function drainUnusedOriginalBody(request: Request): Promise<void> {
  const body: ReadableStream<Uint8Array> | null = request.body;
  if (body === null || request.bodyUsed || body.locked) return;
  const maximumBytes: number = 900000;
  const reader: ReadableStreamBYOBReader = body.getReader({ mode: "byob" });
  let receivedBytes: number = 0;
  try {
    while (true) {
      const result = await reader.read(new Uint8Array(Math.min(65536, maximumBytes - receivedBytes + 1)));
      if (result.value !== undefined) receivedBytes += result.value.byteLength;
      if (receivedBytes > maximumBytes) throw new Error("복원 원본 검증 요청 본문이 900000바이트 상한을 초과했습니다.");
      if (result.done) return;
    }
  } catch (error: unknown) {
    throw new Error("거절된 복원 원본 검증 요청의 본문을 소진하지 못했습니다.", { cause: error });
  } finally { reader.releaseLock(); }
}
const worker = { async fetch(request: Request, env: Environment): Promise<Response> {
  try { return await run(request, env); }
  catch (error: unknown) { if (!(error instanceof Error)) throw error; if (new URL(request.url).pathname === "/restore/original") await drainUnusedOriginalBody(request); return Response.json({ name: error.name, message: error.message, cause: error.cause instanceof Error ? error.cause.message : null }, { status: 409 }); }
} };

export default worker;
