import { z } from "zod";
import { recordId, timestamp, contentHash } from "../domain/contracts.ts";
import { fundingSnapshot } from "../ai/funding.ts";
import { containsAuthenticationMaterial } from "./safety.ts";
import { backupCatalog } from "./catalog.ts";
import type { BackupTable, BackupTableName } from "./catalog.ts";

export const backupPolicy = Object.freeze({ schemaVersion: 1, maximumPageRows: 32, maximumPageBytes: 4_194_304, maximumFieldCharacters: 2_097_152, maximumManifestBytes: 8_388_608, maximumPages: 10_000, maximumObjects: 10_000, maximumObjectBytes: 268_435_456 });
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const backupOwner = z.string().min(1).max(200);
export const backupBasis = z.object({ sourceProjectId: z.string().min(1).max(200), ownerId: backupOwner, revision: integer, catalogHash: hash, startedAt: timestamp }).strict();
export type BackupBasis = Readonly<z.infer<typeof backupBasis>>;
export const backupPath = z.string().regex(/^(pages\/[a-z_]+\/[0-9]{6}\.json|objects\/[0-9]{6}\.bin)$/);
export const backupObjectKey = z.string().min(1).max(1024).refine(value => !value.startsWith("/") && !/[\\\u0000-\u001f?#%]/.test(value) && !value.split("/").some(part => part === "." || part === ".." || part === "") && !value.includes("://"));
const scalar = z.union([z.string().max(backupPolicy.maximumFieldCharacters), z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER), z.null()]);
export type BackupScalar = z.infer<typeof scalar>;
export type BackupRow = Readonly<Record<string, BackupScalar>>;
const tableName = z.string().refine((name): name is BackupTableName => backupCatalog.some(table => table.name === name));
export const backupPageHeader = z.object({ schemaVersion: z.literal(1), backupId: recordId, basis: backupBasis, table: tableName, role: z.enum(["learning", "history-only"]), ordinal: integer, cursorBefore: integer, cursorAfter: integer, final: z.boolean(), rows: z.array(z.record(scalar)).max(backupPolicy.maximumPageRows) }).strict();
export type BackupPage = Readonly<z.infer<typeof backupPageHeader>>;
export const backupPageEntry = z.object({ table: tableName, ordinal: integer, path: backupPath, bytes: integer.max(backupPolicy.maximumPageBytes), sha256: hash, count: integer.max(backupPolicy.maximumPageRows), cursorBefore: integer, cursorAfter: integer, final: z.boolean() }).strict();
export const backupObjectEntry = z.object({ materialId: recordId, uploadId: recordId, objectKey: backupObjectKey, path: backupPath, bytes: integer.max(backupPolicy.maximumObjectBytes), objectVersion: z.string().min(1).max(200), etag: z.string().min(1).max(200), sha256: hash }).strict();
export type BackupObjectEntry = Readonly<z.infer<typeof backupObjectEntry>>;
export const backupManifest = z.object({ schemaVersion: z.literal(1), backupId: recordId, state: z.literal("complete"), basis: backupBasis, completedAt: timestamp, checksumAlgorithm: z.literal("SHA-256"), executionAuthority: z.literal("none"), credentials: z.literal("excluded"), pages: z.array(backupPageEntry).max(backupPolicy.maximumPages), objects: z.array(backupObjectEntry).max(backupPolicy.maximumObjects), counts: z.array(z.object({ table: tableName, rows: integer }).strict()).length(backupCatalog.length) }).strict();
export type BackupManifest = Readonly<z.infer<typeof backupManifest>>;
export type BackupFailureCode = "unsupported-schema" | "invalid-field" | "unknown-table" | "owner-mismatch" | "duplicate-key" | "invalid-page" | "page-too-large" | "incomplete-manifest" | "invalid-object" | "authentication-material" | "export-conflict" | "missing-export" | "incomplete-export" | "learning-active" | "unsettled-upload" | "object-changed" | "incomplete-download";
export type BackupFailure = Error & Readonly<{ code: BackupFailureCode; location: string }>;
/** 오류에는 입력 값·본문·자격 정보를 넣지 않고 고정된 필드 위치만 남깁니다. */
export function backupFailure(code: BackupFailureCode, location: string): BackupFailure {
  return Object.assign(new Error(`백업 검증 실패 (${code}): ${location}. 해당 백업 항목을 확인하세요.`), { name: "BackupFailure", code, location });
}
export function backupTable(name: string): BackupTable {
  const table = backupCatalog.find(item => item.name === name);
  if (!table) throw backupFailure("unknown-table", "table");
  return table;
}
function redactFunding(raw: BackupScalar): string {
  if (typeof raw !== "string") throw backupFailure("invalid-field", "ai_funding_checks.snapshot");
  let value: unknown;
  try { value = JSON.parse(raw); } catch (error: unknown) { if (!(error instanceof SyntaxError)) throw error; throw backupFailure("invalid-field", "ai_funding_checks.snapshot"); }
  const parsed = fundingSnapshot.safeParse(value);
  if (!parsed.success) throw backupFailure("invalid-field", "ai_funding_checks.snapshot");
  const item = parsed.data;
  return JSON.stringify({ id: item.id, pricingVersionId: item.pricingVersionId, billingMode: item.billingMode, creditAvailableUnits: item.creditAvailableUnits, minimumTopupUnits: item.minimumTopupUnits, payments: item.payments, automaticRecharge: item.automaticRecharge, source: item.source, checkedAt: item.checkedAt, validUntil: item.validUntil, evidence: item.evidence, reservationUsdMicros: item.reservationUsdMicros ?? null, prepaidProbe: item.prepaidProbe ?? null, ...(item.coffeeProbe ? { coffeeProbe: item.coffeeProbe } : {}) });
}
/** 원본 행 전체를 펼치지 않고 허용된 열만 복사합니다. 학습 회차와 인증 세션은 별개입니다. */
export function projectBackupRow(name: BackupTableName, source: Readonly<Record<string, unknown>>, ownerId: string): BackupRow {
  const table = backupTable(name);
  if (source.owner_id !== ownerId) throw backupFailure("owner-mismatch", `${table.name}.owner_id`);
  const row: Record<string, BackupScalar> = {};
  for (const column of table.columns) {
    const value = source[column.name];
    const valid = column.kind === "integer" ? z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER) : z.string().max(backupPolicy.maximumFieldCharacters);
    const result = (column.nullable ? valid.nullable() : valid).safeParse(value);
    if (!result.success) throw backupFailure("invalid-field", `${table.name}.${column.name}`);
    row[column.name] = table.name === "ai_funding_checks" && column.name === "snapshot" ? redactFunding(result.data) : result.data;
  }
  validateBackupRow(name, row, ownerId);
  return row;
}
export function backupRowKey(table: BackupTable, row: BackupRow): string {
  return JSON.stringify(table.primaryKey.map(column => row[column]));
}
/** 받은 백업 행에는 허용하지 않은 필드가 하나라도 있으면 거부합니다. */
export function validateBackupRow(name: BackupTableName, row: BackupRow, ownerId: string): void {
  const table = backupTable(name); const columns = new Set(table.columns.map(column => column.name));
  if (Object.keys(row).some(key => !columns.has(key)) || Object.keys(row).length !== columns.size) throw backupFailure("invalid-field", `${table.name}.columns`);
  if (row.owner_id !== ownerId) throw backupFailure("owner-mismatch", `${table.name}.owner_id`);
  for (const column of table.columns) {
    const value = row[column.name];
    if (typeof value === "string" && containsAuthenticationMaterial(value)) throw backupFailure("authentication-material", `${table.name}.${column.name}`);
    if (value === null ? !column.nullable : column.kind === "integer" ? typeof value !== "number" || !Number.isSafeInteger(value) : typeof value !== "string" || value.length > backupPolicy.maximumFieldCharacters) throw backupFailure("invalid-field", `${table.name}.${column.name}`);
  }
  if (name === "ai_funding_checks") validateArchivedFunding(row.snapshot);
}
export function validateBackupPage(value: unknown): BackupPage {
  requireBackupSchema(value);
  const parsed = backupPageHeader.safeParse(value);
  if (!parsed.success) throw backupFailure("invalid-page", "page.schema");
  const page = parsed.data; const table = backupTable(page.table);
  if (page.role !== table.role || page.cursorAfter < page.cursorBefore || page.rows.length > 0 && page.cursorAfter - page.cursorBefore < page.rows.length || page.rows.length === 0 && page.cursorAfter !== page.cursorBefore || !page.final && page.rows.length === 0) throw backupFailure("invalid-page", "page.cursor-or-role");
  const keys = new Set<string>();
  for (const row of page.rows) { validateBackupRow(page.table, row, page.basis.ownerId); const key = backupRowKey(table, row); if (keys.has(key)) throw backupFailure("duplicate-key", `${table.name}.primaryKey`); keys.add(key); }
  if (new TextEncoder().encode(JSON.stringify(page)).byteLength > backupPolicy.maximumPageBytes) throw backupFailure("page-too-large", "page.bytes");
  return page;
}
export async function backupCatalogHash(): Promise<string> { return contentHash(backupCatalog); }

function requireBackupSchema(value: unknown): void {
  const parsed = z.object({ schemaVersion: z.literal(1) }).safeParse(value);
  if (!parsed.success) throw backupFailure("unsupported-schema", "schemaVersion");
}
function validateArchivedFunding(raw: BackupScalar): void {
  if (typeof raw !== "string") throw backupFailure("invalid-field", "ai_funding_checks.snapshot");
  let value: unknown;
  try { value = JSON.parse(raw); } catch (error: unknown) { if (!(error instanceof SyntaxError)) throw error; throw backupFailure("invalid-field", "ai_funding_checks.snapshot"); }
  const keys: readonly string[] = ["id", "pricingVersionId", "billingMode", "creditAvailableUnits", "minimumTopupUnits", "payments", "automaticRecharge", "source", "checkedAt", "validUntil", "evidence", "reservationUsdMicros", "prepaidProbe"];
  const object = z.record(z.unknown()).safeParse(value);
  if (!object.success || Object.keys(object.data).length !== keys.length + (object.data.coffeeProbe === undefined ? 0 : 1) || Object.keys(object.data).some(key => !keys.includes(key) && key !== "coffeeProbe")) throw backupFailure("invalid-field", "ai_funding_checks.snapshot");
  const input = object.data;
  const restored = fundingSnapshot.safeParse({ ...input, reservationUsdMicros: input.reservationUsdMicros === null ? undefined : input.reservationUsdMicros, prepaidProbe: input.prepaidProbe === null ? undefined : input.prepaidProbe, ownerId: "archive-validation", accountFingerprint: "0".repeat(64), reconciledReservationIds: [] });
  if (!restored.success) throw backupFailure("invalid-field", "ai_funding_checks.snapshot");
}
export function backupPagePath(table: BackupTableName, ordinal: number): string {
  if (!integer.max(backupPolicy.maximumPages - 1).safeParse(ordinal).success) throw backupFailure("invalid-page", "page.ordinal");
  backupTable(table);
  return `pages/${table}/${String(ordinal).padStart(6, "0")}.json`;
}
export function backupObjectPath(ordinal: number): string {
  if (!integer.max(backupPolicy.maximumObjects - 1).safeParse(ordinal).success) throw backupFailure("invalid-object", "object.ordinal");
  return `objects/${String(ordinal).padStart(6, "0")}.bin`;
}
/** 완료 표시뿐 아니라 모든 테이블의 마지막 페이지·개수·연속 커서와 객체 식별자의 유일성을 확인합니다. */
export function validateBackupManifest(value: unknown, expectedCatalogHash: string): BackupManifest {
  requireBackupSchema(value);
  const parsed = backupManifest.safeParse(value);
  if (!parsed.success) throw backupFailure("incomplete-manifest", "manifest.schema");
  const manifest = parsed.data;
  if (manifest.basis.catalogHash !== expectedCatalogHash || manifest.completedAt < manifest.basis.startedAt) throw backupFailure("incomplete-manifest", "manifest.basis");
  if (new TextEncoder().encode(JSON.stringify(manifest)).byteLength > backupPolicy.maximumManifestBytes) throw backupFailure("incomplete-manifest", "manifest.bytes");
  if (containsAuthenticationMaterial(JSON.stringify(manifest))) throw backupFailure("authentication-material", "manifest");
  const counts = new Map(manifest.counts.map(item => [item.table, item.rows]));
  if (counts.size !== backupCatalog.length) throw backupFailure("incomplete-manifest", "manifest.counts");
  const paths: Set<string> = new Set();
  for (const table of backupCatalog) {
    const entries = manifest.pages.filter(page => page.table === table.name).toSorted((left, right) => left.ordinal - right.ordinal);
    if (entries.length === 0) throw backupFailure("incomplete-manifest", `${table.name}.pages`);
    let cursor: number = 0; let rows: bigint = BigInt(0);
    for (const [ordinal, entry] of entries.entries()) {
      if (entry.ordinal !== ordinal || entry.path !== backupPagePath(table.name, ordinal) || entry.cursorBefore !== cursor || entry.cursorAfter - entry.cursorBefore < entry.count || entry.final !== (ordinal === entries.length - 1) || entry.count === 0 && (!entry.final || entry.cursorAfter !== entry.cursorBefore) || entry.bytes === 0 || paths.has(entry.path)) throw backupFailure("incomplete-manifest", `${table.name}.pages`);
      paths.add(entry.path); cursor = entry.cursorAfter; rows += BigInt(entry.count);
    }
    if (rows !== BigInt(counts.get(table.name) ?? -1)) throw backupFailure("incomplete-manifest", `${table.name}.count`);
  }
  const objectKeys: Set<string> = new Set(); const uploadIds: Set<string> = new Set();
  for (const [ordinal, object] of manifest.objects.entries()) {
    if (object.path !== backupObjectPath(ordinal) || object.bytes === 0 || paths.has(object.path) || objectKeys.has(object.objectKey) || uploadIds.has(object.uploadId)) throw backupFailure("invalid-object", "manifest.objects");
    paths.add(object.path); objectKeys.add(object.objectKey); uploadIds.add(object.uploadId);
  }
  return manifest;
}
