import { readCompletedBackup } from "./backup-completion.ts";
import { readRegisteredStorage } from "./restore-storage.ts";
import type { AtomicDatabase } from "./atomic.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import type { StorageContext } from "../../lib/backup/storage-identity.ts";
import { backupTextHash } from "../../lib/backup/pagination.ts";
import { restoreAuthorityFailure, signRestoreAuthorization } from "../../lib/backup/restore-authority.ts";
import type { RestoreChallenge } from "../../lib/backup/restore-authority.ts";

type BackupRestoreApproval = Readonly<{ token: string; backupId: string; manifestSha256: string; expiresAt: number }>;
/** 서버가 완료 백업의 영수증에서 재구성한 해시만 서명합니다. 요청자가 보낸 완료 여부나 해시는 승인 근거가 아닙니다. */
export async function approveBackupRestore(db: AtomicDatabase, bucket: R2Bucket, context: StorageContext, owner: SiteIdentity, privateKey: CryptoKey, challenge: RestoreChallenge, backupId: string, now: number): Promise<BackupRestoreApproval> {
  const storage = await readRegisteredStorage(db, bucket, context, owner, "primary");
  const manifest = await readCompletedBackup(db, owner, backupId);
  if (manifest.basis.sourceProjectId !== context.projectId || manifest.basis.ownerId !== owner.userId) throw restoreAuthorityFailure("wrong-backup", "manifest-source");
  const manifestSha256 = await backupTextHash(JSON.stringify(manifest)); const expiresAt: number = Math.min(challenge.expiresAt, now + 900000);
  return { token: await signRestoreAuthorization(privateKey, storage.identity, owner, challenge, backupId, manifestSha256, now, expiresAt), backupId, manifestSha256, expiresAt };
}
