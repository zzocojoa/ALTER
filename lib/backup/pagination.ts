import { z } from "zod";
import { backupPageEntry, backupPagePath, backupPolicy, backupFailure, validateBackupPage } from "./contracts.ts";
import type { BackupPage } from "./contracts.ts";

export type BackupPageEntry = Readonly<z.infer<typeof backupPageEntry>>;
export type RowSize = Readonly<{ cursor: number; bytes: number }>;
export type PageSelection = Readonly<{ cursors: readonly number[]; final: boolean }>;
export type EncodedBackupPage = Readonly<{ page: BackupPage; json: string; entry: BackupPageEntry }>;

/** 큰 본문을 읽기 전에 작은 크기 목록으로 최대 32행·4MiB 범위를 확정합니다. */
export function selectBackupRows(rows: readonly RowSize[]): PageSelection {
  if (rows.length > backupPolicy.maximumPageRows + 1) throw backupFailure("invalid-page", "page.sizes");
  const accepted: number[] = [];
  let remaining: number = backupPolicy.maximumPageBytes - 4096;
  let previous: number = 0;
  for (const row of rows) {
    if (!Number.isSafeInteger(row.cursor) || row.cursor <= previous || !Number.isSafeInteger(row.bytes) || row.bytes <= 0) throw backupFailure("invalid-page", "page.sizes");
    previous = row.cursor;
    if (accepted.length === backupPolicy.maximumPageRows || row.bytes + 1 > remaining) break;
    accepted.push(row.cursor); remaining -= row.bytes + 1;
  }
  if (rows.length > 0 && accepted.length === 0) throw backupFailure("page-too-large", "page.row");
  return { cursors: accepted, final: accepted.length === rows.length };
}

/** 체크섬은 정규화된 별도 객체가 아니라 실제 전달하는 UTF-8 파일 바이트의 SHA-256입니다. */
export async function encodeBackupPage(value: BackupPage): Promise<EncodedBackupPage> {
  const page: BackupPage = validateBackupPage(value);
  const json: string = JSON.stringify(page);
  const bytes: Uint8Array<ArrayBuffer> = new TextEncoder().encode(json);
  const sha256: string = await backupTextHash(json);
  return { page, json, entry: backupPageEntry.parse({ table: page.table, ordinal: page.ordinal, path: backupPagePath(page.table, page.ordinal), bytes: bytes.byteLength, sha256, count: page.rows.length, cursorBefore: page.cursorBefore, cursorAfter: page.cursorAfter, final: page.final }) };
}


export async function backupTextHash(text: string): Promise<string> {
  const digest: ArrayBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
