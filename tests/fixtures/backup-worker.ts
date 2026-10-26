import { z } from "zod";
import { siteIdentity } from "../../lib/domain/contracts.ts";
import { backupCatalog } from "../../lib/backup/catalog.ts";
import type { BackupTableName } from "../../lib/backup/catalog.ts";
import { startBackup, exportBackupPage, finishBackupDatabase, readBackupRun } from "../../db/repositories/backup.ts";
import { listBackupObjects, acknowledgeBackupObject } from "../../db/repositories/backup-objects.ts";
import { acknowledgeBackupPage, completeBackup, readCompletedBackup } from "../../db/repositories/backup-completion.ts";
import { streamBackupObject } from "../../lib/backup/object-stream.ts";
import { createCheckedByteStream } from "../../lib/materials/checked-stream.ts";
import type { CheckedStreamProof } from "../../lib/materials/checked-stream.ts";
import { materialPolicy } from "../../lib/materials/policy.ts";
import { initializeOwnedUploadFixture } from "./material-transfer-setup.ts";
import { uploadMaterialBody } from "../../lib/materials/upload.ts";
import { getMaterialTransfer } from "../../db/repositories/material-transfers.ts";
import { transitionMaterialTransfer } from "../../lib/materials/transition.ts";
import { readMaterialObject, headMaterialObject } from "../../lib/materials/object.ts";
import { validateTextContent } from "../../lib/materials/text-content.ts";
import type { AtomicDatabase } from "../../db/repositories/atomic.ts";

type Environment = Readonly<{ DB: D1Database; BUCKET: R2Bucket }>;
type Seed = Readonly<{ materialId: string; transferId: string; uploadId: string; key: string; bytes: number; sha256: string }>;
const identity = (owner: string) => siteIdentity.parse({ realm: "sites", userId: owner });

function metadataRequest(request: Request): Request {
  return new Request(request.url, { headers: { "content-type": "text/plain", "x-fixture-kind": "text", "x-fixture-filename": "backup.txt", "x-fixture-bytes": request.headers.get("x-bytes") ?? "", "x-fixture-sha256": request.headers.get("x-sha256") ?? "" } });
}
async function hold(request: Request, env: Environment, owner: string): Promise<Response> {
  const fixture = await initializeOwnedUploadFixture(env.DB, metadataRequest(request), identity(owner));
  await request.body?.cancel();
  const transfer = await getMaterialTransfer(env.DB, fixture.owner, fixture.id);
  return Response.json({ materialId: transfer.materialId, transferId: transfer.id, uploadId: transfer.uploadId, key: transfer.objectKey, bytes: transfer.metadata.bytes, sha256: transfer.metadata.sha256 });
}
async function seed(request: Request, env: Environment, owner: string): Promise<Response> {
  if (!request.body) throw new Error("검증 본문 없음");
  const metadata: Request = metadataRequest(request);
  const fixture = await initializeOwnedUploadFixture(env.DB, metadata, identity(owner));
  await uploadMaterialBody(env.DB, env.BUCKET, fixture.owner, fixture.id, 1, { headers: metadata.headers, body: request.body, signal: request.signal });
  let transfer = await getMaterialTransfer(env.DB, fixture.owner, fixture.id);
  const dispatchId: string = crypto.randomUUID();
  transfer = await transitionMaterialTransfer(env.DB, fixture.owner, transfer, { type: "validate" }, dispatchId);
  const object = await readMaterialObject(env.BUCKET, transfer);
  const content = await validateTextContent(object.body, transfer.metadata, request.signal);
  await headMaterialObject(env.BUCKET, transfer);
  transfer = await transitionMaterialTransfer(env.DB, fixture.owner, transfer, { type: "content-verified", content: { objectVersion: object.version, etag: object.etag, sha256: transfer.metadata.sha256, bytes: object.size, pages: content.pages, kind: "text", policyVersion: materialPolicy.version } }, dispatchId);
  transfer = await transitionMaterialTransfer(env.DB, fixture.owner, transfer, { type: "register" }, dispatchId);
  const result: Seed = { materialId: transfer.materialId, transferId: transfer.id, uploadId: transfer.uploadId, key: transfer.objectKey, bytes: transfer.metadata.bytes, sha256: transfer.metadata.sha256 };
  return Response.json(result);
}
/** 128MiB보다 큰 합성 원본을 실제 로컬 R2로 왕복시키며 전체 버퍼를 만들지 않습니다. */
async function stress(request: Request, env: Environment): Promise<Response> {
  if (!request.body) throw new Error("검증 본문 없음");
  const expected = { bytes: z.number().int().positive().max(268435456).parse(Number(request.headers.get("x-bytes"))), sha256: z.string().regex(/^[a-f0-9]{64}$/).parse(request.headers.get("x-sha256")) };
  const bridge: FixedLengthStream = new FixedLengthStream(expected.bytes); const key: string = `backup-stress/${crypto.randomUUID()}`;
  const proofs: CheckedStreamProof[] = [];
  const input = createCheckedByteStream(request.body, expected, request.signal, async proof => { proofs.push(proof); });
  const outcomes = await Promise.allSettled([input.pipeTo(bridge.writable), env.BUCKET.put(key, bridge.readable)]);
  for (const outcome of outcomes) if (outcome.status === "rejected") throw outcome.reason;
  const body = await env.BUCKET.get(key); if (!body) throw new Error("검증 R2 원본 없음");
  const output = createCheckedByteStream(body.body, expected, request.signal, async proof => { proofs.push(proof); });
  await output.pipeTo(new WritableStream<Uint8Array>({ write(): void {} }));
  await env.BUCKET.delete(key); return Response.json({ proofs, deleted: await env.BUCKET.head(key) === null, wholeIsolateMemoryMeasured: false });
}
async function postReadFailure(env: Environment, key: string, mode: string, owner: string): Promise<void> {
  if (mode === "replace") { await env.BUCKET.put(key, new Uint8Array([98])); return; }
  if (mode === "delete") { await env.BUCKET.delete(key); return; }
  if (mode === "database-change") { await env.DB.prepare("UPDATE courses SET title='백업 중 변경' WHERE owner_id=?").bind(owner).run(); return; }
  throw new Error("지원하지 않는 오류 주입");
}
function changedAfterRead(env: Environment, mode: string, owner: string): Pick<R2Bucket, "head" | "get"> {
  let heads: number = 0;
  return { get: env.BUCKET.get.bind(env.BUCKET), async head(key: string): Promise<R2Object | null> { heads += 1; if (heads === 2) await postReadFailure(env, key, mode, owner); return env.BUCKET.head(key); } };
}
function loseFinalResponse(db: AtomicDatabase): AtomicDatabase {
  let calls: number = 0;
  return { prepare: db.prepare.bind(db), async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> { calls += 1; const result = await db.batch<T>(statements); if (calls === 6) throw new Error("network test: completed response lost"); return result; } };
}

/** 배포에 포함되지 않는 로컬 통합 검사 전용 라우터입니다. */
async function run(request: Request, env: Environment): Promise<Response> {
  const url: URL = new URL(request.url); const owner: string = url.searchParams.get("owner") ?? "backup-worker-owner"; const user = identity(owner); const id: string = url.searchParams.get("id") ?? ""; const ordinal: number = Number(url.searchParams.get("ordinal"));
  if (url.pathname === "/seed") return seed(request, env, owner);
  if (url.pathname === "/hold") return hold(request, env, owner);
  if (url.pathname === "/stress") return stress(request, env);
  if (url.pathname === "/start") return Response.json(await startBackup(env.DB, user, id, "local-backup-project", Date.now()));
  if (url.pathname === "/catalog") return Response.json(backupCatalog.map(table => table.name));
  if (url.pathname === "/page") return Response.json(await exportBackupPage(env.DB, user, id, url.searchParams.get("table") as BackupTableName, ordinal));
  if (url.pathname === "/page-received") { const receipt = await request.json() as { sha256: string; bytes: number }; await acknowledgeBackupPage(env.DB, user, id, url.searchParams.get("table") as BackupTableName, ordinal, receipt.sha256, receipt.bytes, Date.now()); return Response.json({ received: true }); }
  if (url.pathname === "/database") return Response.json(await finishBackupDatabase(env.DB, user, id));
  if (url.pathname === "/objects") return Response.json(await listBackupObjects(env.DB, user, id, Number(url.searchParams.get("offset"))));
  if (url.pathname === "/object") { const fault: string | null = url.searchParams.get("fault"); const result = await streamBackupObject(env.DB, fault === null ? env.BUCKET : changedAfterRead(env, fault, owner), user, id, ordinal, request.signal); return new Response(result.body, { headers: { "x-sha256": result.entry.sha256, "x-bytes": String(result.entry.bytes) } }); }
  if (url.pathname === "/object-received") { const receipt = await request.json() as { sha256: string; bytes: number }; await acknowledgeBackupObject(env.DB, user, id, ordinal, receipt.sha256, receipt.bytes, Date.now()); return Response.json({ received: true }); }
  if (url.pathname === "/complete") return Response.json(await completeBackup(env.DB, user, id, Date.now()));
  if (url.pathname === "/complete-lost-response") return Response.json(await completeBackup(loseFinalResponse(env.DB), user, id, Date.now()));
  if (url.pathname === "/completed") return Response.json(await readCompletedBackup(env.DB, user, id));
  if (url.pathname === "/status") return Response.json(await readBackupRun(env.DB, user, id));
  throw new Error("검증 경로 없음");
}
const worker = { async fetch(request: Request, env: Environment): Promise<Response> { try { return await run(request, env); } catch (error: unknown) { if (!(error instanceof Error)) throw error; return Response.json({ name: error.name, message: error.message, code: "code" in error ? error.code : null, cause: error.cause instanceof Error ? error.cause.message : null }, { status: 409 }); } } };

export default worker;
