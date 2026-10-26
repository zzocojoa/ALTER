import { readBackupRun, requireBackupCurrent } from "../../db/repositories/backup.ts";
import { readBackupSourceObject, resetBackupObjectDownload, saveBackupObjectProof } from "../../db/repositories/backup-objects.ts";
import type { AtomicDatabase } from "../../db/repositories/atomic.ts";
import type { SiteIdentity } from "../domain/contracts.ts";
import { headMaterialObject, readMaterialObject } from "../materials/object.ts";
import { createCheckedByteStream } from "../materials/checked-stream.ts";
import type { BackupObjectEntry } from "./contracts.ts";

export type BackupObjectStream = Readonly<{ body: ReadableStream<Uint8Array>; entry: BackupObjectEntry }>;

/** 원본 버전·해시·기준 버전을 모두 확인한 뒤에만 스트림 EOF와 검증 영수증을 발급합니다. */
export async function streamBackupObject(db: AtomicDatabase, bucket: Pick<R2Bucket, "head" | "get">, owner: SiteIdentity, id: string, ordinal: number, signal: AbortSignal): Promise<BackupObjectStream> {
  const run = requireBackupCurrent(await readBackupRun(db, owner, id));
  const source = await readBackupSourceObject(db, run, ordinal);
  await resetBackupObjectDownload(db, run, ordinal);
  await headMaterialObject(bucket, source.transfer);
  const object: R2ObjectBody = await readMaterialObject(bucket, source.transfer);
  try {
    signal.throwIfAborted();
    const body: ReadableStream<Uint8Array> = createCheckedByteStream(object.body, source.entry, signal, async (): Promise<void> => {
      signal.throwIfAborted(); await headMaterialObject(bucket, source.transfer); signal.throwIfAborted();
      await saveBackupObjectProof(db, run, source, Date.now());
    });
    return { body, entry: source.entry };
  } catch (error: unknown) { await object.body.cancel(error); throw error; }
}
