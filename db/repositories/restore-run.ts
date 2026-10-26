import { z } from "zod";
import { canonicalJson, recordId, timestamp } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import { issueRestoreChallenge, restoreAuthorityFailure, restoreAuthorization, restoreChallenge, verifyRestoreAuthorization } from "../../lib/backup/restore-authority.ts";
import type { RestoreAuthorization, RestoreChallenge, RestoreTrust } from "../../lib/backup/restore-authority.ts";
import type { StorageContext } from "../../lib/backup/storage-identity.ts";
import { readStorage } from "./atomic.ts";
import type { AtomicDatabase } from "./atomic.ts";
import { backupGuard } from "./backup.ts";
import { readRegisteredStorage } from "./restore-storage.ts";
import type { RegisteredStorage } from "./restore-storage.ts";

const challengeRow = z.object({ id: recordId, owner_id: z.string(), target_identity: z.string(), issued_at: timestamp, expires_at: timestamp, consumed_at: timestamp.nullable(), consumed_run_id: recordId.nullable() }).strict();
type ChallengeRow = Readonly<z.infer<typeof challengeRow>>;
const runRow = z.object({ id: recordId, owner_id: z.string(), challenge_id: recordId, authorization: z.string(), started_at: timestamp, state: z.enum(["receiving", "verifying", "verified", "activated", "failed"]) }).strict();
type RunRow = Readonly<z.infer<typeof runRow>>;
export type RestoreRun = Readonly<{ id: string; challengeId: string; authorization: RestoreAuthorization; startedAt: number; state: RunRow["state"] }>;
function challengeView(row: ChallengeRow): RestoreChallenge { return restoreChallenge.parse({ id: row.id, target: JSON.parse(row.target_identity), issuedAt: row.issued_at, expiresAt: row.expires_at }); }
function runView(row: RunRow): RestoreRun { return { id: row.id, challengeId: row.challenge_id, authorization: restoreAuthorization.parse(JSON.parse(row.authorization)), startedAt: row.started_at, state: row.state }; }
async function readChallenge(db: AtomicDatabase, owner: SiteIdentity, id: string): Promise<ChallengeRow | null> {
  const row = await readStorage("restore.challenge-read", () => db.prepare("SELECT id,owner_id,target_identity,issued_at,expires_at,consumed_at,consumed_run_id FROM restore_challenges WHERE owner_id=? AND id=?").bind(owner.userId, recordId.parse(id)).first<ChallengeRow>());
  return row === null ? null : challengeRow.parse(row);
}
async function storedRun(db: AtomicDatabase, owner: SiteIdentity, id: string): Promise<RunRow | null> {
  const row = await readStorage("restore.run-read", () => db.prepare("SELECT id,owner_id,challenge_id,authorization,started_at,state FROM restore_runs WHERE owner_id=? AND id=?").bind(owner.userId, recordId.parse(id)).first<RunRow>());
  return row === null ? null : runRow.parse(row);
}
function storageGuard(db: AtomicDatabase, id: string, storage: RegisteredStorage): D1PreparedStatement {
  return backupGuard(db, id, "EXISTS(SELECT 1 FROM restore_storage WHERE slot=1 AND state='ready' AND identity=? AND marker_version=? AND marker_bytes=?)", [canonicalJson(storage.identity), storage.markerVersion, storage.markerBytes]);
}
function checkChallenge(row: ChallengeRow, storage: RegisteredStorage, now: number): RestoreChallenge {
  if (row.target_identity !== canonicalJson(storage.identity) || row.consumed_at !== null) throw restoreAuthorityFailure("wrong-challenge", "challenge-state");
  if (now < row.issued_at || now >= row.expires_at) throw restoreAuthorityFailure("invalid-time", "challenge-window");
  return challengeView(row);
}
/** 동일 요청 재시도는 첫 유효 기간을 유지합니다. 만료된 요청을 같은 ID로 연장하지 않습니다. */
export async function createRestoreChallenge(db: AtomicDatabase, bucket: R2Bucket, context: StorageContext, owner: SiteIdentity, id: string, now: number, expiresAt: number): Promise<RestoreChallenge> {
  const storage = await readRegisteredStorage(db, bucket, context, owner, "restore-test");
  const challenge = issueRestoreChallenge(storage.identity, owner, id, now, expiresAt);
  const previous = await readChallenge(db, owner, id); if (previous !== null) return checkChallenge(previous, storage, now);
  const check: string = crypto.randomUUID();
  await readStorage("restore.challenge-create", () => db.batch([
    storageGuard(db, check, storage),
    backupGuard(db, `${check}-empty`, "NOT EXISTS(SELECT 1 FROM restore_runs)", []),
    db.prepare("INSERT INTO restore_challenges(id,owner_id,target_identity,issued_at,expires_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO NOTHING").bind(id, owner.userId, canonicalJson(challenge.target), now, expiresAt),
    db.prepare("DELETE FROM backup_checks WHERE id IN (?,?)").bind(check, `${check}-empty`),
  ]));
  const saved = await readChallenge(db, owner, id); if (saved === null) throw restoreAuthorityFailure("wrong-challenge", "challenge-missing");
  return checkChallenge(saved, storage, now);
}
/** 승인 검증과 대상의 일회용 요청 소비를 결합합니다. 실행 시작만 기록하며 데이터나 외부 권한은 활성화하지 않습니다. */
export async function startRestoreRun(db: AtomicDatabase, bucket: R2Bucket, context: StorageContext, owner: SiteIdentity, trust: RestoreTrust, token: string, id: string, challengeId: string, backupId: string, manifestSha256: string, now: number): Promise<RestoreRun> {
  recordId.parse(id); timestamp.parse(now);
  const storage = await readRegisteredStorage(db, bucket, context, owner, "restore-test");
  const challenge = await readChallenge(db, owner, challengeId); if (challenge === null) throw restoreAuthorityFailure("wrong-challenge", "challenge-missing");
  const authorization = await verifyRestoreAuthorization(token, trust, storage.identity, owner, challengeView(challenge), backupId, manifestSha256, now);
  const encoded: string = canonicalJson(authorization); const previous = await storedRun(db, owner, id);
  if (previous !== null) { if (previous.authorization !== encoded || challenge.consumed_run_id !== id) throw restoreAuthorityFailure("wrong-backup", "run-reused"); return runView(previous); }
  checkChallenge(challenge, storage, now); const check: string = crypto.randomUUID();
  await readStorage("restore.run-start", () => db.batch([
    storageGuard(db, check, storage),
    db.prepare("UPDATE restore_challenges SET consumed_at=?,consumed_run_id=? WHERE id=? AND owner_id=? AND target_identity=? AND issued_at<=? AND expires_at>? AND consumed_at IS NULL AND consumed_run_id IS NULL").bind(now, id, challengeId, owner.userId, canonicalJson(storage.identity), now, now),
    backupGuard(db, `${check}-consume`, "EXISTS(SELECT 1 FROM restore_challenges WHERE id=? AND owner_id=? AND consumed_run_id=?)", [challengeId, owner.userId, id]),
    db.prepare("INSERT INTO restore_runs(id,owner_id,challenge_id,authorization,started_at,state) VALUES (?,?,?,?,?,'receiving') ON CONFLICT(id) DO NOTHING").bind(id, owner.userId, challengeId, encoded, now),
    backupGuard(db, `${check}-run`, "EXISTS(SELECT 1 FROM restore_runs WHERE id=? AND owner_id=? AND challenge_id=? AND authorization=?)", [id, owner.userId, challengeId, encoded]),
    db.prepare("DELETE FROM backup_checks WHERE id IN (?,?,?)").bind(check, `${check}-consume`, `${check}-run`),
  ]));
  const saved = await storedRun(db, owner, id); if (saved === null) throw restoreAuthorityFailure("wrong-backup", "run-missing"); return runView(saved);
}
export async function readRestoreRun(db: AtomicDatabase, bucket: R2Bucket, context: StorageContext, owner: SiteIdentity, id: string): Promise<RestoreRun> {
  const storage = await readRegisteredStorage(db, bucket, context, owner, "restore-test"); const row = await storedRun(db, owner, id);
  if (row === null) throw restoreAuthorityFailure("wrong-backup", "run-missing");
  const result = runView(row); if (canonicalJson(result.authorization.challenge.target) !== canonicalJson(storage.identity)) throw restoreAuthorityFailure("unsafe-target", "run-storage"); return result;
}
