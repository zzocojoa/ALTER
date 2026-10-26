import { backupPath } from "./contracts.ts";

export type BackupArchiveFile = Readonly<{ path: string; file: Blob }>;
/** 압축이나 원본 재적재 없이 파일 Blob을 참조하는 표준 ustar 헤더를 만듭니다. */
export function backupTarHeader(path: string, bytes: number): Uint8Array<ArrayBuffer> {
  if (path !== "manifest.json") backupPath.parse(path);
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > 8_589_934_591 || new TextEncoder().encode(path).length > 99) throw new Error("백업 파일 경로나 크기가 TAR 형식 범위를 벗어났습니다.");
  const header = new Uint8Array(512); const encoder = new TextEncoder();
  const fields: readonly Readonly<{ offset: number; value: string }>[] = [{ offset: 0, value: path }, { offset: 100, value: "0000600\0" }, { offset: 108, value: "0000000\0" }, { offset: 116, value: "0000000\0" }, { offset: 124, value: bytes.toString(8).padStart(11, "0") + "\0" }, { offset: 136, value: "00000000000\0" }, { offset: 148, value: "        " }, { offset: 156, value: "0" }, { offset: 257, value: "ustar\0" }, { offset: 263, value: "00" }];
  for (const field of fields) header.set(encoder.encode(field.value), field.offset);
  const checksum: number = header.reduce((sum, byte) => sum + byte, 0);
  header.set(encoder.encode(checksum.toString(8).padStart(6, "0") + "\0 "), 148); return header;
}
export function createBackupArchive(files: readonly BackupArchiveFile[]): Blob {
  if (files.length === 0 || new Set(files.map(file => file.path)).size !== files.length || !files.some(file => file.path === "manifest.json")) throw new Error("완료 명세가 없거나 백업 파일 경로가 중복됩니다.");
  const parts: BlobPart[] = files.flatMap(({ path, file }) => [backupTarHeader(path, file.size), file, new Uint8Array((512 - file.size % 512) % 512)]);
  return new Blob([...parts, new Uint8Array(1024)], { type: "application/x-tar" });
}
