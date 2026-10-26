import { constants } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import type { BigIntStats } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { backupPath, backupPolicy } from "../../lib/backup/contracts.ts";
import { preflightFailure, requirePreflight } from "./failure.ts";

export type BackupFile = Readonly<{ name: string; bytes: number; fingerprint: string }>;
export type FileDigest = Readonly<{ sha256: string; bytes: number; maximumReadBufferBytes: number }>;
const maximumEntries: number = backupPolicy.maximumPages + backupPolicy.maximumObjects + 200;
function fingerprint(stat: BigIntStats): string { return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs, stat.nlink].map(String).join(":"); }
function requireFile(stat: BigIntStats, name: string): void { requirePreflight(stat.isFile() && stat.nlink === BigInt(1), "unsafe-file", name, "regular file without links", "non-regular file or link"); }
export async function backupRoot(directory: string): Promise<string> {
  const root: string = await realpath(directory);
  requirePreflight((await lstat(root)).isDirectory(), "unsafe-directory", "archive", "directory", "non-directory"); return root;
}
export async function inspectBackupFile(root: string, name: string): Promise<BackupFile> {
  requirePreflight(name === "manifest.json" || backupPath.safeParse(name).success, "unsafe-path", "archive.entry", "canonical backup path", "invalid path");
  const filename: string = path.join(root, name);
  try {
    requirePreflight(await realpath(filename) === filename, "unsafe-path", name, "path inside archive without symlinks", "redirected path");
    const stat: BigIntStats = await lstat(filename, { bigint: true }); requireFile(stat, name);
    requirePreflight(stat.size <= BigInt(Number.MAX_SAFE_INTEGER), "file-size", name, "safe byte count", "oversized file");
    return { name, bytes: Number(stat.size), fingerprint: fingerprint(stat) };
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && ["ENOENT", "EACCES", "EPERM", "ENOTDIR", "ELOOP"].includes(String(error.code))) throw preflightFailure("file-unavailable", name, "accessible regular file", String(error.code));
    throw error;
  }
}
/** 파일 목록도 개수를 제한하며 심볼릭 링크는 따라가지 않습니다. */
export async function inventoryBackup(root: string): Promise<readonly BackupFile[]> {
  const files: BackupFile[] = []; const directories: string[] = [""]; let seen: number = 0;
  for (let i: number = 0; i < directories.length; i += 1) {
    const directory: string = directories[i];
    for await (const entry of await opendir(path.join(root, directory))) {
      seen += 1; requirePreflight(seen <= maximumEntries, "entry-limit", "archive", String(maximumEntries), "too many entries");
      const relative: string = directory ? `${directory}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        requirePreflight(relative === "pages" || relative === "objects" || /^pages\/[a-z_]+$/.test(relative), "unsafe-path", "archive.directory", "backup directory", "unexpected directory");
        directories.push(relative);
      } else files.push(await inspectBackupFile(root, relative));
    }
  }
  return files.toSorted((a, b) => a.name.localeCompare(b.name));
}
/** JSON은 상한 내 한 파일만 보유하고 원본은 같은 64KiB 읽기로 해시만 계산합니다. */
async function readFileChunks(root: string, file: BackupFile, accept: (chunk: Uint8Array) => void): Promise<FileDigest> {
  const handle = await open(path.join(root, file.name), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before: BigIntStats = await handle.stat({ bigint: true }); requireFile(before, file.name);
    requirePreflight(fingerprint(before) === file.fingerprint, "file-changed", file.name, "unchanged inventory identity", "changed before read");
    const hash = createHash("sha256"); const buffer: Buffer = Buffer.alloc(65536); let bytes: number = 0;
    for (;;) {
      const read = await handle.read(buffer, 0, buffer.length, null); if (read.bytesRead === 0) break;
      bytes += read.bytesRead; requirePreflight(bytes <= file.bytes, "file-changed", file.name, String(file.bytes), String(bytes));
      const chunk: Buffer = buffer.subarray(0, read.bytesRead); hash.update(chunk); accept(chunk);
    }
    requirePreflight(bytes === file.bytes && fingerprint(await handle.stat({ bigint: true })) === file.fingerprint, "file-changed", file.name, "unchanged complete file", "changed during read");
    return { sha256: hash.digest("hex"), bytes, maximumReadBufferBytes: buffer.length };
  } finally { await handle.close(); }
}
export async function hashBackupFile(root: string, file: BackupFile): Promise<FileDigest> { return readFileChunks(root, file, (): void => {}); }
export async function readBackupJson(root: string, file: BackupFile, maximumBytes: number): Promise<Readonly<{ value: unknown; digest: FileDigest }>> {
  requirePreflight(file.bytes <= maximumBytes, "file-size", file.name, `at most ${maximumBytes} bytes`, String(file.bytes));
  const decoder: TextDecoder = new TextDecoder("utf-8", { fatal: true }); const chunks: string[] = [];
  try {
    const digest: FileDigest = await readFileChunks(root, file, chunk => { chunks.push(decoder.decode(chunk, { stream: true })); });
    chunks.push(decoder.decode()); return { value: JSON.parse(chunks.join("")), digest };
  } catch (error: unknown) {
    if (error instanceof SyntaxError || error instanceof TypeError) throw preflightFailure("invalid-json", file.name, "valid UTF-8 JSON", "invalid encoding or JSON");
    throw error;
  }
}
