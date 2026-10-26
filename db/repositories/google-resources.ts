import { z } from "zod";
import { command, recordId, siteIdentity, timestamp } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import { googleFailure } from "../../lib/google/errors.ts";
import { googlePickerSelection } from "../../lib/google/picker.ts";
import type { GooglePickerCredentials, GooglePickerSelection } from "../../lib/google/picker.ts";
import { googleExternalId } from "../../lib/google/resources.ts";
import type { GoogleStoredResourceRole, GoogleVerifiedFile } from "../../lib/google/resources.ts";
import { executeAtomic, readStorage, requireInBatch } from "./atomic.ts";
import type { Receipt } from "./atomic.ts";
import type { ManagedGoogleConnection } from "./google-managed.ts";

/** 서버에서 검증한 토큰과 같은 세대가 살아 있을 때만 선택 시도를 발급합니다. */
export async function saveGooglePickerLease(db: D1Database, owner: SiteIdentity, value: GooglePickerCredentials, role: GooglePickerSelection["role"], now: number): Promise<Receipt> {
  timestamp.parse(now);
  const context = command.parse({ owner, requestKey: value.leaseId, expectedVersion: 1 });
  return executeAtomic(db, context, "google.picker.issue", { connectionId: value.connectionId, generation: value.generation, expiresAt: value.leaseExpiresAt, role }, value.leaseId, 1, requestId => [
    requireInBatch(db, owner.userId, requestId, 0, "EXISTS(SELECT 1 FROM google_runtime WHERE owner_id=? AND connection_id=? AND generation=? AND state IN ('active','partial'))", [owner.userId, value.connectionId, value.generation]),
    db.prepare("INSERT INTO google_picker_leases VALUES (?,?,?,?,?,?,?,'active')").bind(owner.userId, value.leaseId, value.connectionId, value.generation, role, now, value.leaseExpiresAt),
  ]);
}

/** 선택 결과가 중복 전송되어도 제공사 확인 호출의 실행권은 한 번만 반환합니다. */
export async function consumeGooglePickerLease(db: D1Database, owner: SiteIdentity, value: GooglePickerSelection, now: number): Promise<void> {
  const selection: GooglePickerSelection = googlePickerSelection.parse(value); siteIdentity.parse(owner); timestamp.parse(now);
  const result = await db.prepare("UPDATE google_picker_leases SET state='consumed' WHERE owner_id=? AND id=? AND connection_id=? AND generation=? AND role=? AND state='active' AND issued_at<=? AND expires_at>? AND EXISTS(SELECT 1 FROM google_runtime r WHERE r.owner_id=google_picker_leases.owner_id AND r.connection_id=google_picker_leases.connection_id AND r.generation=google_picker_leases.generation AND r.state IN ('active','partial')) RETURNING id").bind(owner.userId, selection.leaseId, selection.connectionId, selection.generation, selection.role, now, now).all<{ id: string }>();
  if (result.meta.changes !== 1 || result.results.length !== 1) throw googleFailure("google_scope_denied", "picker-lease-invalid");
}
export async function cancelGooglePickerLease(db: D1Database, owner: SiteIdentity, leaseId: string): Promise<void> {
  siteIdentity.parse(owner); recordId.parse(leaseId);
  const result = await db.prepare("UPDATE google_picker_leases SET state='canceled' WHERE owner_id=? AND id=? AND state='active' RETURNING id").bind(owner.userId, leaseId).all<{ id: string }>();
  if (result.meta.changes !== 1) throw googleFailure("google_scope_denied", "picker-cancel-invalid");
}

/** 서버가 확인한 파일만 등록하고 소비한 시도의 역할을 쓰기 권한으로 바꾸지 않습니다. */
export async function registerGoogleSelectedFile(db: D1Database, owner: SiteIdentity, selection: GooglePickerSelection, file: GoogleVerifiedFile, now: number): Promise<Receipt> {
  googlePickerSelection.parse(selection); timestamp.parse(now);
  if (selection.fileId !== file.externalId || selection.role !== file.role || file.checkedAt > now || now - file.checkedAt >= 60_000) throw googleFailure("google_scope_denied", "picker-file-mismatch");
  const context = command.parse({ owner, requestKey: selection.leaseId, expectedVersion: 1 });
  return executeAtomic(db, context, "google.resource.register", { selection, file, now }, selection.leaseId, 1, requestId => [
    requireInBatch(db, owner.userId, requestId, 0, "EXISTS(SELECT 1 FROM google_picker_leases l JOIN google_runtime r ON r.owner_id=l.owner_id AND r.connection_id=l.connection_id AND r.generation=l.generation WHERE l.owner_id=? AND l.id=? AND l.connection_id=? AND l.generation=? AND l.role=? AND l.state='consumed' AND l.expires_at>? AND r.state IN ('active','partial'))", [owner.userId, selection.leaseId, selection.connectionId, selection.generation, selection.role, now]),
    db.prepare("INSERT INTO google_resources VALUES (?,?,?,?,?,?,'picker',?,?,?) ON CONFLICT(owner_id,connection_id,generation,external_id,role) DO UPDATE SET evidence_id=excluded.evidence_id,approved_at=excluded.approved_at,metadata=excluded.metadata").bind(owner.userId, selection.leaseId, selection.connectionId, selection.generation, file.externalId, file.role, selection.leaseId, now, JSON.stringify(file)),
  ]);
}
const resourceRow = z.object({ id: recordId, externalId: googleExternalId, role: z.enum(["reference", "docs-target", "sheets-target", "calendar-target", "folder-target"]), source: z.enum(["picker", "app-created"]), approvedAt: timestamp, metadata: z.string() }).strict();
export type StoredGoogleResource = Readonly<z.infer<typeof resourceRow>>;
export async function readGoogleResource(db: D1Database, owner: SiteIdentity, connection: ManagedGoogleConnection, externalId: string, role: GoogleStoredResourceRole): Promise<StoredGoogleResource> {
  googleExternalId.parse(externalId); siteIdentity.parse(owner);
  if (role === "folder-target") {
    const folder=await readStorage("google.folder.read",()=>db.prepare("SELECT f.id,f.external_id AS externalId,f.approved_at AS approvedAt FROM google_report_folders f JOIN google_runtime r ON r.owner_id=f.owner_id AND r.connection_id=f.connection_id AND r.generation=f.generation WHERE f.owner_id=? AND f.connection_id=? AND f.generation=? AND f.external_id=? AND r.state IN ('active','partial')").bind(owner.userId,connection.connectionId,connection.generation,externalId).first());
    if(folder===null) throw googleFailure("google_scope_denied","folder-not-app-created");
    const data=z.object({id:recordId,externalId:googleExternalId,approvedAt:timestamp}).strict().parse(folder);
    return resourceRow.parse({...data,role,source:"app-created",metadata:JSON.stringify(data)});
  }
  const row: unknown = await readStorage("google.resource.read", () => db.prepare("SELECT f.id,f.external_id AS externalId,f.role,f.source,f.approved_at AS approvedAt,f.metadata FROM google_resources f JOIN google_runtime r ON r.owner_id=f.owner_id AND r.connection_id=f.connection_id AND r.generation=f.generation WHERE f.owner_id=? AND f.connection_id=? AND f.generation=? AND f.external_id=? AND f.role=? AND r.state IN ('active','partial')").bind(owner.userId, connection.connectionId, connection.generation, externalId, role).first());
  if (row === null) throw googleFailure("google_scope_denied", "resource-not-approved");
  return resourceRow.parse(row);
}

/** 앱 생성 주장은 받지 않고 성공한 제공사 생성 요청의 자원 ID를 D1에서 대조합니다. */
export async function registerGoogleCreatedResource(db: D1Database, owner: SiteIdentity, connection: ManagedGoogleConnection, attemptId: string, externalId: string, role: "docs-target" | "sheets-target" | "calendar-target" | "folder-target", now: number): Promise<Receipt> {
  recordId.parse(attemptId); googleExternalId.parse(externalId); timestamp.parse(now);
  const method: string = role === "docs-target" ? "docs.documents.create" : role === "sheets-target" ? "sheets.spreadsheets.create" : role === "folder-target" ? "drive.files.create" : "calendar.calendars.insert";
  const context = command.parse({ owner, requestKey: attemptId, expectedVersion: 1 });
  return executeAtomic(db, context, "google.resource.created", { externalId, role, generation: connection.generation }, attemptId, 1, requestId => [
    requireInBatch(db, owner.userId, requestId, 0, "EXISTS(SELECT 1 FROM google_requests q JOIN google_runtime r ON r.owner_id=q.owner_id AND r.connection_id=q.connection_id AND r.generation=q.generation WHERE q.owner_id=? AND q.id=? AND q.connection_id=? AND q.generation=? AND q.method=? AND q.state='succeeded' AND q.result_external_id=? AND r.state IN ('active','partial'))", [owner.userId, attemptId, connection.connectionId, connection.generation, method, externalId]),
    role === "folder-target" ? db.prepare("INSERT INTO google_report_folders VALUES (?,?,?,?,?,?)").bind(owner.userId,attemptId,connection.connectionId,connection.generation,externalId,now) : db.prepare("INSERT INTO google_resources VALUES (?,?,?,?,?,?,'app-created',?,?,?)").bind(owner.userId, attemptId, connection.connectionId, connection.generation, externalId, role, attemptId, now, JSON.stringify({ externalId, role, createdAt: now })),
  ]);
}
