import { z } from "zod";
import { recordId, timestamp } from "../domain/contracts.ts";
import { googleFailure } from "./errors.ts";
import type { GoogleResourceGrant } from "./permissions.ts";
import type { GooglePickerSelection } from "./picker.ts";

export const googleFileId = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
export const googleExternalId = z.string().min(1).max(500).regex(/^[A-Za-z0-9_.@-]+$/).refine(value => value !== "primary" && /[A-Za-z0-9]/.test(value));
export const googleFileMetadata = z.object({ id: googleFileId, name: z.string().min(1).max(1024), mimeType: z.string().min(1).max(200), trashed: z.boolean(), isAppAuthorized: z.boolean(), modifiedTime: z.string().datetime(), capabilities: z.object({ canEdit: z.boolean() }), size: z.string().regex(/^\d{1,19}$/).optional() });
export type GoogleFileMetadata = Readonly<z.infer<typeof googleFileMetadata>>;
export type GoogleStoredResourceRole = "reference" | "docs-target" | "sheets-target" | "calendar-target" | "folder-target";
export type GoogleVerifiedFile = Readonly<{ externalId: string; name: string; mimeType: string; modifiedTime: string; role: GooglePickerSelection["role"] | "folder-target"; checkedAt: number }>;

/** Picker의 제목·권한 주장 대신 현재 연결로 읽은 Drive 메타데이터를 검증합니다. */
export function verifyGoogleFile(value: unknown, fileId: string, role: GooglePickerSelection["role"] | "folder-target", now: number): GoogleVerifiedFile {
  timestamp.parse(now); googleFileId.parse(fileId);
  const parsed = googleFileMetadata.safeParse(value);
  if (!parsed.success) throw googleFailure("google_scope_denied", "file-metadata-invalid");
  const file: GoogleFileMetadata = parsed.data;
  if (file.id !== fileId || file.trashed || !file.isAppAuthorized) throw googleFailure("google_scope_denied", "file-not-authorized");
  const accepted: readonly string[] = role === "reference" ? ["application/vnd.google-apps.document", "application/vnd.google-apps.spreadsheet", "application/pdf", "text/plain", "image/png", "image/jpeg"] : role === "folder-target" ? ["application/vnd.google-apps.folder"] : [role === "docs-target" ? "application/vnd.google-apps.document" : "application/vnd.google-apps.spreadsheet"];
  if (!accepted.includes(file.mimeType) || role !== "reference" && !file.capabilities.canEdit) throw googleFailure("google_scope_denied", "file-role-denied");
  return { externalId: file.id, name: file.name, mimeType: file.mimeType, modifiedTime: file.modifiedTime, role, checkedAt: now };
}

/** 저장된 승인은 현재 Google 권한 검증의 대체물이 아닙니다. */
export function verifiedGoogleResourceGrant(ownerId: string, connectionId: string, generation: number, approvedAt: number, appCreated: boolean, file: GoogleVerifiedFile, now: number): GoogleResourceGrant {
  if (file.checkedAt > now || now - file.checkedAt >= 60_000 || approvedAt > now) throw googleFailure("google_scope_denied", "file-check-expired");
  return { ownerId, connectionId: recordId.parse(connectionId), generation, role: file.role, externalId: file.externalId, appCreated, approvedAt, checkedAt: file.checkedAt, validUntil: file.checkedAt + 60_000 };
}
