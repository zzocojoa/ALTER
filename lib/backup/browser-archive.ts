import { backupCatalogHash, backupPath, backupPolicy, backupPagePath, validateBackupManifest } from "./contracts.ts";
import type { BackupManifest } from "./contracts.ts";
import { verifyBackupBlob } from "./browser-files.ts";
import { backupTextHash } from "./pagination.ts";
import { validateRestorePageDocument } from "./restore-document.ts";
import { planRestoreOriginal } from "./restore-original.ts";
import type { RestoreOriginalInput } from "./restore-original.ts";
import { materialPolicy } from "../materials/policy.ts";
export type BrowserBackupArchive = Readonly<{ manifest: BackupManifest; manifestText: string; manifestSha256: string; files: ReadonlyMap<string, Blob>; originals: readonly RestoreOriginalInput[] }>;
function tarString(header: Uint8Array, start: number, length: number): string {
  const bytes = header.subarray(start, start + length); const zero: number = bytes.indexOf(0); const value = zero < 0 ? bytes : bytes.subarray(0, zero);
  if (value.some(byte => byte < 32 || byte > 126) || zero >= 0 && bytes.subarray(zero).some(byte => byte !== 0)) throw new Error("백업 TAR 헤더 문자가 올바르지 않습니다.");
  return new TextDecoder().decode(value);
}
function tarOctal(header: Uint8Array, start: number, length: number): number {
  const value = new TextDecoder().decode(header.subarray(start, start + length)).replace(/[\0 ]+$/g, "");
  if (!/^[0-7]+$/.test(value)) throw new Error("백업 TAR 숫자 필드가 올바르지 않습니다.");
  return Number.parseInt(value, 8);
}
/** 링크·확장 헤더·임의 경로는 거부하며 원본은 선택한 파일의 Blob 조각으로만 참조합니다. */
async function tarFiles(file: Blob, signal: AbortSignal): Promise<ReadonlyMap<string, Blob>> {
  if (file.size % 512 !== 0 || file.size > materialPolicy.maximumStorageBytes + 32_000_000) throw new Error("ALTER 백업 TAR 크기 제한을 벗어났습니다.");
  const files = new Map<string, Blob>(); let offset: number = 0;
  while (offset + 512 <= file.size) {
    signal.throwIfAborted(); const header = new Uint8Array(await file.slice(offset, offset + 512).arrayBuffer());
    if (header.every(byte => byte === 0)) {
      if (file.size - offset < 1024) throw new Error("백업 TAR 종료 블록이 없습니다.");
      for (let tail: number = offset; tail < file.size; tail += 65_536) if (new Uint8Array(await file.slice(tail, tail + 65_536).arrayBuffer()).some(byte => byte !== 0)) throw new Error("백업 TAR 종료 뒤에 다른 데이터가 있습니다.");
      return files;
    }
    const checksum: number = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    if (checksum !== tarOctal(header, 148, 8) || tarString(header, 257, 6) !== "ustar" || tarString(header, 263, 2) !== "00" || header[156] !== 48 || tarString(header, 157, 100) !== "" || tarString(header, 345, 155) !== "") throw new Error("지원하지 않거나 손상된 백업 TAR 헤더입니다.");
    const name: string = tarString(header, 0, 100); if (name !== "manifest.json") backupPath.parse(name);
    const bytes: number = tarOctal(header, 124, 12); const end: number = offset + 512 + bytes;
    if (end > file.size || files.has(name) || files.size >= backupPolicy.maximumPages + backupPolicy.maximumObjects + 1) throw new Error("백업 TAR 파일이 누락되었거나 경로가 중복됩니다.");
    files.set(name, file.slice(offset + 512, end)); offset = end + (512 - bytes % 512) % 512;
  }
  throw new Error("백업 TAR 종료 블록이 없습니다.");
}
export function archiveFile(archive: BrowserBackupArchive, name: string): Blob {
  const file = archive.files.get(name); if (!file) throw new Error(`백업에 필요한 파일이 없습니다: ${name}`); return file;
}
/** 서버 전송 전에 모든 체크섬과 페이지 기준을 대조합니다. 전체 참조 무결성은 대상 D1에서 다시 검사합니다. */
export async function readBrowserBackupArchive(file: Blob, signal: AbortSignal, progress: (message: string) => void): Promise<BrowserBackupArchive> {
  const files = await tarFiles(file, signal); const manifestFile = files.get("manifest.json");
  if (!manifestFile || manifestFile.size > backupPolicy.maximumManifestBytes) throw new Error("백업 완료 명세가 없거나 크기 제한을 넘었습니다.");
  const manifestText: string = await manifestFile.text(); const manifest = validateBackupManifest(JSON.parse(manifestText), await backupCatalogHash());
  const expected = new Set(["manifest.json", ...manifest.pages.map(entry => entry.path), ...manifest.objects.map(entry => entry.path)]);
  if (files.size !== expected.size || [...files.keys()].some(name => !expected.has(name))) throw new Error("백업 파일 목록과 완료 명세가 다릅니다.");
  const uploads = new Map<string, number>(); const transfers = new Map<string, number>();
  for (const [index, entry] of manifest.pages.entries()) {
    progress(`복원 전 기록 검사 · ${index + 1}/${manifest.pages.length}`); const pageFile = files.get(entry.path); if (!pageFile) throw new Error("명세의 백업 페이지가 없습니다.");
    await verifyBackupBlob(pageFile, entry, signal); const { page } = await validateRestorePageDocument(await pageFile.text(), manifest, entry.path);
    if (page.table === "uploads" || page.table === "material_transfers") { const destination = page.table === "uploads" ? uploads : transfers; for (const row of page.rows) { if (typeof row.id !== "string" || destination.has(row.id)) throw new Error("원본 참조 기록이 중복되거나 올바르지 않습니다."); destination.set(row.id, page.ordinal); } }
  }
  const originals: RestoreOriginalInput[] = [];
  for (const [ordinal, entry] of manifest.objects.entries()) {
    progress(`복원 전 원본 검사 · ${ordinal + 1}/${manifest.objects.length}`); const original = files.get(entry.path); if (!original) throw new Error("명세의 원본 파일이 없습니다."); await verifyBackupBlob(original, entry, signal);
    const uploadPage = uploads.get(entry.uploadId); const transferPage = transfers.get(entry.uploadId); if (uploadPage === undefined || transferPage === undefined) throw new Error("원본의 업로드·전송 기록이 없습니다.");
    const uploadPath = backupPagePath("uploads", uploadPage); const transferPath = backupPagePath("material_transfers", transferPage);
    const uploadFile = files.get(uploadPath); const transferFile = files.get(transferPath); if (!uploadFile || !transferFile) throw new Error("원본 참조 페이지가 없습니다.");
    const input: RestoreOriginalInput = { ordinal, uploadPage, transferPage };
    planRestoreOriginal(manifest, input, (await validateRestorePageDocument(await uploadFile.text(), manifest, uploadPath)).page, (await validateRestorePageDocument(await transferFile.text(), manifest, transferPath)).page); originals.push(input);
  }
  return { manifest, manifestText, manifestSha256: await backupTextHash(manifestText), files, originals };
}
