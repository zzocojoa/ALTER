import { sha256 } from "@noble/hashes/sha2.js";
import { backupPath } from "./contracts.ts";

export type BackupFileProof = Readonly<{ bytes: number; sha256: string }>;
export type BackupBrowserStorage = Readonly<{ write: (path: string, stream: ReadableStream<Uint8Array>, expected: BackupFileProof, signal: AbortSignal) => Promise<File>; read: (path: string, expected: BackupFileProof, signal: AbortSignal) => Promise<File>; saveManifest: (text: string) => Promise<File> }>;
function fileKey(path: string): string { return backupPath.parse(path).replaceAll("/", "__"); }
function hex(bytes: Uint8Array): string { return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join(""); }
/** 전체 파일 대신 64KiB 조각으로 체크섬을 계산합니다. */
export async function verifyBackupBlob(file: Blob, expected: BackupFileProof, signal: AbortSignal): Promise<void> {
  if (file.size !== expected.bytes) throw new Error("받은 백업 파일의 크기가 명세와 다릅니다.");
  const hash: ReturnType<typeof sha256.create> = sha256.create();
  for (let offset: number = 0; offset < file.size; offset += 65_536) { signal.throwIfAborted(); hash.update(new Uint8Array(await file.slice(offset, offset + 65_536).arrayBuffer())); }
  if (hex(hash.digest()) !== expected.sha256) throw new Error("받은 백업 파일의 SHA-256이 명세와 다릅니다.");
}
async function requireLocalCapacity(bytes: number): Promise<void> {
  const space: StorageEstimate = await navigator.storage.estimate();
  if (space.quota === undefined || space.usage === undefined || space.quota - space.usage < bytes + 8_388_608) throw new Error("이 브라우저의 백업 저장 공간을 확인할 수 없거나 부족합니다. 저장 공간이 있는 브라우저에서 다시 진행해 주세요.");
}
async function writeBrowserFile(directory: FileSystemDirectoryHandle, key: string, stream: ReadableStream<Uint8Array>, expected: BackupFileProof, signal: AbortSignal): Promise<File> {
  await requireLocalCapacity(expected.bytes);
  const handle: FileSystemFileHandle = await directory.getFileHandle(key, { create: true }); const output: FileSystemWritableFileStream = await handle.createWritable();
  const reader: ReadableStreamDefaultReader<Uint8Array> = stream.getReader(); const hash: ReturnType<typeof sha256.create> = sha256.create(); let bytes: number = 0;
  try {
    while (true) {
      signal.throwIfAborted(); const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.length; if (bytes > expected.bytes) throw new Error("백업 응답이 명세의 파일 크기를 초과했습니다.");
      for (let offset: number = 0; offset < chunk.value.length; offset += 65_536) { const part = new Uint8Array(chunk.value.subarray(offset, offset + 65_536)); hash.update(part); await output.write(part); }
    }
    if (bytes !== expected.bytes || hex(hash.digest()) !== expected.sha256) throw new Error("백업 전송이 중단됐거나 체크섬이 일치하지 않습니다. 완료로 처리하지 않았습니다.");
    await output.close();
  } catch (error: unknown) {
    const cleanup = await Promise.allSettled([reader.cancel(), output.abort()]);
    const failed = cleanup.filter((item): item is PromiseRejectedResult => item.status === "rejected");
    if (failed.length > 0) throw new AggregateError([error, ...failed.map(item => item.reason)], "백업 수신과 임시 파일 종료에 실패했습니다. 같은 백업 ID로 상태를 확인해 주세요.");
    throw error;
  } finally { reader.releaseLock(); }
  const file = await handle.getFile(); await verifyBackupBlob(file, expected, signal); return file;
}
/** 브라우저의 사이트 전용 파일 저장소에 보관하며 수신 완료 뒤 다시 읽어 검증합니다. */
export async function openBackupBrowserStorage(id: string): Promise<BackupBrowserStorage> {
  if (!navigator.storage?.getDirectory) throw new Error("이 브라우저는 백업용 파일 저장소를 지원하지 않습니다. 최신 Chrome 또는 Safari에서 열어 주세요.");
  const root = await navigator.storage.getDirectory(); const backups = await root.getDirectoryHandle("alter-backups", { create: true }); const directory = await backups.getDirectoryHandle(id, { create: true });
  return {
    write: (path, stream, expected, signal) => writeBrowserFile(directory, fileKey(path), stream, expected, signal),
    read: async (path, expected, signal) => { const file = await (await directory.getFileHandle(fileKey(path))).getFile(); await verifyBackupBlob(file, expected, signal); return file; },
    saveManifest: async text => { const blob = new Blob([text]); const hash = hex(sha256(new TextEncoder().encode(text))); return writeBrowserFile(directory, "manifest.json", blob.stream(), { bytes: blob.size, sha256: hash }, new AbortController().signal); },
  };
}
