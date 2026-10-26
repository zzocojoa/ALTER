import { z } from "zod";
import { encryptedToken, googleIdentity, recordId, scope, siteIdentity, timestamp, domainFailure } from "../../lib/domain/contracts.ts";
import type { Command, EncryptedToken, SiteIdentity } from "../../lib/domain/contracts.ts";
import { executeAtomic, guardedUpdate, readStorage } from "./atomic.ts";
import type { Receipt } from "./atomic.ts";

const connectionInput = z.object({ id: recordId, google: googleIdentity, scopes: z.array(scope).min(1), expiresAt: timestamp, token: encryptedToken }).strict().refine((value) => new Set(value.scopes).size === value.scopes.length);
const selectionInput = z.object({ id: recordId, connectionId: recordId, materialId: recordId, externalId: z.string().min(1), modifiedAt: z.string().min(1) }).strict();
const targetInput = z.object({ id: recordId, connectionId: recordId, externalId: z.string().min(1), kind: z.enum(["docs", "sheets", "calendar"]), appCreated: z.boolean(), approvedAt: timestamp }).strict().refine((value) => value.kind !== "calendar" || value.appCreated);
export type ConnectionInput = z.infer<typeof connectionInput>;
export type SelectionInput = z.infer<typeof selectionInput>;
export type TargetInput = z.infer<typeof targetInput>;
export type ConnectionPublic = Readonly<{ id: string; googleSubject: string; scopes: string[]; expiresAt: number; revokedAt: number | null; reconnectRequired: boolean; version: number }>;
type ConnectionRow = Readonly<{ id: string; google_subject: string; scopes: string; expires_at: number; revoked_at: number | null; reconnect_required: number; version: number }>;

/** 암호화 수행은 호출자의 책임이며 저장소는 평문 토큰 필드를 받지 않습니다. */
export async function connectGoogle(db: D1Database, context: Command, value: ConnectionInput): Promise<Receipt> {
  const input: ConnectionInput = connectionInput.parse(value);
  return executeAtomic(db, context, "google.connect", input, input.id, 1, (requestId: string) => googleConnectionStatements(db, context.owner, input, requestId));
}
/** 기존 검증 계약과 실제 OAuth 저장이 같은 연결·암호문 SQL을 사용합니다. */
export function googleConnectionStatements(db: D1Database, owner: SiteIdentity, input: ConnectionInput, requestId: string): readonly D1PreparedStatement[] {
  return [db.prepare("INSERT INTO google_connections VALUES (?,?,1,?,?,?,?,NULL,0)").bind(owner.userId, input.id, requestId, input.google.subject, JSON.stringify(input.scopes), input.expiresAt), ...googleTokenStatements(db, owner, input.id, input.token, requestId)];
}
export function googleTokenStatements(db: D1Database, owner: SiteIdentity, connectionId: string, token: EncryptedToken, requestId: string): readonly D1PreparedStatement[] {
  return [db.prepare("INSERT INTO google_tokens VALUES (?,?,1,?,?,?,?,?,?)").bind(owner.userId, connectionId, requestId, connectionId, token.algorithm, token.ciphertext, token.nonce, token.keyVersion)];
}
export async function rotateGoogleToken(db: D1Database, context: Command, connectionId: string, tokenVersion: number, token: EncryptedToken, expiresAt: number): Promise<Receipt> {
  recordId.parse(connectionId); encryptedToken.parse(token); timestamp.parse(expiresAt); z.number().int().positive().parse(tokenVersion);
  return executeAtomic(db, context, "google.rotate", { tokenVersion, token, expiresAt }, connectionId, context.expectedVersion + 1, (requestId: string) => [
    ...guardedUpdate(db, "google_connections", context.owner.userId, connectionId, context.expectedVersion, requestId, 0, "expires_at = ?, reconnect_required = 0", [expiresAt], "revoked_at IS NULL", []),
    ...guardedUpdate(db, "google_tokens", context.owner.userId, connectionId, tokenVersion, requestId, 1, "ciphertext = ?, nonce = ?, key_version = ?", [token.ciphertext, token.nonce, token.keyVersion], "connection_id = ?", [connectionId]),
  ]);
}
export async function revokeGoogle(db: D1Database, context: Command, connectionId: string, revokedAt: number): Promise<Receipt> {
  recordId.parse(connectionId); timestamp.parse(revokedAt);
  return executeAtomic(db, context, "google.revoke", { revokedAt }, connectionId, context.expectedVersion + 1, (requestId: string) => guardedUpdate(db, "google_connections", context.owner.userId, connectionId, context.expectedVersion, requestId, 0, "revoked_at = ?, reconnect_required = 1", [revokedAt], "revoked_at IS NULL", []));
}
export async function selectReference(db: D1Database, context: Command, value: SelectionInput): Promise<Receipt> {
  const input: SelectionInput = selectionInput.parse(value);
  return executeAtomic(db, context, "google.reference.select", input, input.id, 1, () => [db.prepare("INSERT INTO reference_selections VALUES (?,?,?,?,?,?)").bind(context.owner.userId, input.id, input.connectionId, input.materialId, input.externalId, input.modifiedAt)]);
}
export async function approveWriteTarget(db: D1Database, context: Command, value: TargetInput): Promise<Receipt> {
  const input: TargetInput = targetInput.parse(value);
  return executeAtomic(db, context, "google.target.approve", input, input.id, 1, () => [db.prepare("INSERT INTO write_targets VALUES (?,?,?,?,?,?,?)").bind(context.owner.userId, input.id, input.connectionId, input.externalId, input.kind, Number(input.appCreated), input.approvedAt)]);
}
export async function getGoogleConnection(db: D1Database, owner: SiteIdentity, id: string): Promise<ConnectionPublic> {
  siteIdentity.parse(owner); recordId.parse(id);
  const row: ConnectionRow | null = await readStorage("google.public", () => db.prepare("SELECT id,google_subject,scopes,expires_at,revoked_at,reconnect_required,version FROM google_connections WHERE owner_id = ? AND id = ?").bind(owner.userId, id).first<ConnectionRow>());
  if (row === null) throw domainFailure("reference_conflict", "google.public", null);
  return { id: row.id, googleSubject: row.google_subject, scopes: z.array(scope).parse(JSON.parse(row.scopes)), expiresAt: row.expires_at, revokedAt: row.revoked_at, reconnectRequired: row.reconnect_required === 1, version: row.version };
}
export async function requireReferenceAccess(db: D1Database, owner: SiteIdentity, connectionId: string, externalId: string, now: number): Promise<void> {
  const connection: ConnectionPublic = await getGoogleConnection(db, owner, connectionId);
  requireActiveConnection(connection, "https://www.googleapis.com/auth/drive.file", now);
  const found = await readStorage("google.reference", () => db.prepare("SELECT id FROM reference_selections WHERE owner_id = ? AND connection_id = ? AND external_id = ?").bind(owner.userId, connectionId, externalId).first<{ id: string }>());
  if (found === null) throw domainFailure("reference_conflict", "google.reference", null);
}
export async function requireWriteAccess(db: D1Database, owner: SiteIdentity, connectionId: string, externalId: string, kind: "docs" | "sheets" | "calendar", now: number): Promise<void> {
  const connection: ConnectionPublic = await getGoogleConnection(db, owner, connectionId);
  requireActiveConnection(connection, kind === "calendar" ? "https://www.googleapis.com/auth/calendar.app.created" : "https://www.googleapis.com/auth/drive.file", now);
  const found = await readStorage("google.write", () => db.prepare("SELECT id FROM write_targets WHERE owner_id = ? AND connection_id = ? AND external_id = ? AND kind = ? AND (kind != 'calendar' OR app_created = 1)").bind(owner.userId, connectionId, externalId, kind).first<{ id: string }>());
  if (found === null) throw domainFailure("reference_conflict", "google.write", null);
}
function requireActiveConnection(connection: ConnectionPublic, requiredScope: string, now: number): void {
  timestamp.parse(now);
  if (connection.revokedAt !== null || connection.reconnectRequired || connection.expiresAt <= now || !connection.scopes.includes(requiredScope)) throw domainFailure("reference_conflict", "google.authorization", null);
}
