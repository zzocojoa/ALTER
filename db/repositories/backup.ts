import { z } from "zod";
import { backupCatalog } from "../../lib/backup/catalog.ts";
import type { BackupTable, BackupTableName } from "../../lib/backup/catalog.ts";
import { backupBasis, backupCatalogHash, backupFailure, backupPageEntry, backupPagePath, backupPolicy, backupTable, projectBackupRow } from "../../lib/backup/contracts.ts";
import type { BackupBasis, BackupPage } from "../../lib/backup/contracts.ts";
import { encodeBackupPage, selectBackupRows } from "../../lib/backup/pagination.ts";
import type { BackupPageEntry, EncodedBackupPage, RowSize } from "../../lib/backup/pagination.ts";
import { recordId, siteIdentity, timestamp } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import { readStorage } from "./atomic.ts";
import type { AtomicDatabase, SqlValue } from "./atomic.ts";

const safeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const runSchema = z.object({ owner_id: z.string(), id: recordId, source_project_id: z.string(), catalog_hash: z.string(), revision: safeInteger, started_at: timestamp, state: z.enum(["exporting", "database-ready", "complete", "cancelled"]) }).strict();
type StoredRun = Readonly<z.infer<typeof runSchema>>;
export type BackupRun = Readonly<{ id: string; state: StoredRun["state"]; basis: BackupBasis; current: boolean }>;
export type StoredPage = Readonly<{ table_name: BackupTableName; ordinal: number; cursor_before: number; cursor_after: number; row_count: number; bytes: number; sha256: string; final: number }>;
type SelectedRow = Readonly<Record<string, unknown>> & Readonly<{ backup_cursor: number }>;
export type BackupTableCount = Readonly<{ table: BackupTableName; rows: number }>;
export type BackupDatabaseReceipt = Readonly<{ run: BackupRun; pages: readonly BackupPageEntry[]; counts: readonly BackupTableCount[] }>;

function quote(name: string): string { return `"${name}"`; }
function runView(row: StoredRun, revision: number): BackupRun {
  return { id: row.id, state: row.state, current: row.revision === revision && row.state !== "cancelled", basis: backupBasis.parse({ sourceProjectId: row.source_project_id, ownerId: row.owner_id, revision: row.revision, catalogHash: row.catalog_hash, startedAt: row.started_at }) };
}
export function backupGuard(db: AtomicDatabase, id: string, predicate: string, params: readonly SqlValue[]): D1PreparedStatement {
  return db.prepare(`INSERT INTO backup_checks(id,matched) VALUES (?,CASE WHEN (${predicate}) THEN 1 ELSE 0 END)`).bind(id, ...params);
}
function removeGuard(db: AtomicDatabase, id: string): D1PreparedStatement { return db.prepare("DELETE FROM backup_checks WHERE id=?").bind(id); }
function snapshotPredicate(): string {
  return "EXISTS(SELECT 1 FROM backup_runs b JOIN backup_revisions v ON v.owner_id=b.owner_id WHERE b.owner_id=? AND b.id=? AND b.revision=? AND v.revision=b.revision AND b.catalog_hash=? AND b.state IN ('exporting','database-ready') AND NOT EXISTS(SELECT 1 FROM attempts a WHERE a.owner_id=b.owner_id AND a.status='awaiting-answer'))";
}
function snapshotParams(run: BackupRun): readonly SqlValue[] { return [run.basis.ownerId, run.id, run.basis.revision, run.basis.catalogHash]; }

/** 조회와 동일 트랜잭션의 무조건 CHECK를 사용해 변경 경합을 실패시킵니다. 메타데이터 재시도는 같은 키를 유지합니다. */
export async function backupBatch(db: AtomicDatabase, statements: readonly D1PreparedStatement[], operation: string): Promise<D1Result[]> {
  try { return await readStorage(operation, () => db.batch([...statements])); }
  catch (error: unknown) {
    if (error instanceof Error && error.cause instanceof Error && /backup_snapshot_matched/.test(error.cause.message)) throw backupFailure("export-conflict", operation);
    throw error;
  }
}
export async function snapshotRead(db: AtomicDatabase, run: BackupRun, statement: D1PreparedStatement, operation: string): Promise<D1Result> {
  const id: string = crypto.randomUUID();
  const result: D1Result[] = await backupBatch(db, [backupGuard(db, id, snapshotPredicate(), snapshotParams(run)), statement, removeGuard(db, id)], operation);
  return result[1];
}
export async function readBackupRun(db: AtomicDatabase, owner: SiteIdentity, id: string): Promise<BackupRun> {
  siteIdentity.parse(owner); recordId.parse(id);
  const row = await readStorage("backup.status", () => db.prepare("SELECT b.*,v.revision AS current_revision FROM backup_runs b JOIN backup_revisions v ON v.owner_id=b.owner_id WHERE b.owner_id=? AND b.id=?").bind(owner.userId, id).first<StoredRun & { current_revision: number }>());
  if (!row) throw backupFailure("missing-export", "backup.id");
  const { current_revision: revision, ...stored } = row;
  const parsed: StoredRun = runSchema.parse(stored);
  const run: BackupRun = runView(parsed, safeInteger.parse(revision));
  return { ...run, current: run.current && run.basis.catalogHash === await backupCatalogHash() };
}

/** 요청 UUID가 같으면 시작 시각과 기준 버전을 바꾸지 않습니다. 실패 후 새 백업으로 자동 우회하지 않습니다. */
export async function startBackup(db: AtomicDatabase, owner: SiteIdentity, id: string, projectId: string, now: number): Promise<BackupRun> {
  siteIdentity.parse(owner); recordId.parse(id); timestamp.parse(now); z.string().min(1).max(200).parse(projectId);
  const active = await readStorage("backup.learning-visibility", () => db.prepare("SELECT id FROM attempts WHERE owner_id=? AND status='awaiting-answer' LIMIT 1").bind(owner.userId).first<{ id: string }>());
  if (active !== null) throw backupFailure("learning-active", "backup.learning-visibility");
  const catalogHash: string = await backupCatalogHash(); const check: string = crypto.randomUUID();
  await backupBatch(db, [
    db.prepare("INSERT INTO backup_revisions(owner_id,revision) VALUES (?,0) ON CONFLICT(owner_id) DO NOTHING").bind(owner.userId),
    db.prepare("INSERT INTO backup_runs(owner_id,id,source_project_id,catalog_hash,revision,started_at,state) SELECT owner_id,?,?,?,revision,?,'exporting' FROM backup_revisions WHERE owner_id=? ON CONFLICT(owner_id,id) DO NOTHING").bind(id, projectId, catalogHash, now, owner.userId),
    backupGuard(db, check, "EXISTS(SELECT 1 FROM backup_runs b JOIN backup_revisions v ON v.owner_id=b.owner_id WHERE b.owner_id=? AND b.id=? AND b.source_project_id=? AND b.catalog_hash=? AND b.revision=v.revision AND b.state IN ('exporting','database-ready') AND NOT EXISTS(SELECT 1 FROM attempts a WHERE a.owner_id=b.owner_id AND a.status='awaiting-answer'))", [owner.userId, id, projectId, catalogHash]), removeGuard(db, check),
  ], "backup.start");
  return requireBackupCurrent(await readBackupRun(db, owner, id));
}
export function requireBackupCurrent(run: BackupRun): BackupRun {
  if (!run.current || !["exporting", "database-ready"].includes(run.state)) throw backupFailure("export-conflict", "backup.basis");
  return run;
}
export function backupPageReceipt(page: StoredPage): BackupPageEntry {
  return backupPageEntry.parse({ table: page.table_name, ordinal: page.ordinal, cursorBefore: page.cursor_before, cursorAfter: page.cursor_after, count: page.row_count, bytes: page.bytes, sha256: page.sha256, final: page.final === 1, path: backupPagePath(page.table_name, page.ordinal) });
}
function rowSizeSql(table: BackupTable): string {
  const fixed: number = 2 + Math.max(0, table.columns.length - 1) + table.columns.reduce((sum, column) => sum + JSON.stringify(column.name).length + 1, 0);
  return `${fixed} + ${table.columns.map(column => column.kind === "integer" ? `length(CAST(json_quote(${quote(column.name)}) AS BLOB))` : textJsonBytesSql(quote(column.name))).join(" + ")}`;
}
/** JSON 이스케이프가 D1 단일 문자열 한도를 넘지 않도록 256KiB씩 크기만 계산합니다. */
function textJsonBytesSql(column: string): string {
  const parts: readonly string[] = Array.from({ length: 8 }, (_, index) => `(length(CAST(json_quote(CAST(substr(CAST(${column} AS BLOB),${index * 262144 + 1},262144) AS TEXT)) AS BLOB))-2)`);
  return `(CASE WHEN ${column} IS NULL THEN 4 WHEN length(CAST(${column} AS BLOB))>2097152 THEN ${backupPolicy.maximumPageBytes + 1} WHEN length(CAST(${column} AS BLOB))<=300000 THEN length(CAST(json_quote(${column}) AS BLOB)) ELSE (2+${parts.join("+")}) END)`;
}
async function precedingCursor(db: AtomicDatabase, run: BackupRun, table: BackupTableName, ordinal: number): Promise<number> {
  if (ordinal === 0) return 0;
  const result: D1Result = await snapshotRead(db, run, db.prepare("SELECT cursor_after,final FROM backup_pages WHERE owner_id=? AND backup_id=? AND table_name=? AND ordinal=?").bind(run.basis.ownerId, run.id, table, ordinal - 1), "backup.previous-page");
  const previous = z.object({ cursor_after: safeInteger, final: z.literal(0) }).safeParse(result.results[0]);
  if (!previous.success) throw backupFailure("incomplete-export", `${table}.previous-page`);
  return previous.data.cursor_after;
}

/** 한 페이지의 본문만 보유하며 각 D1 조회와 해시 계산 뒤 저장 경계에서 같은 기준을 다시 검사합니다. */
export async function exportBackupPage(db: AtomicDatabase, owner: SiteIdentity, id: string, name: BackupTableName, ordinal: number): Promise<EncodedBackupPage> {
  const table: BackupTable = backupTable(name); backupPagePath(name, ordinal);
  const run: BackupRun = requireBackupCurrent(await readBackupRun(db, owner, id));
  const cursor: number = await precedingCursor(db, run, name, ordinal);
  const metadata: D1Result = await snapshotRead(db, run, db.prepare(`SELECT rowid AS cursor,${rowSizeSql(table)} AS bytes FROM ${quote(table.name)} WHERE owner_id=? AND rowid>? ORDER BY rowid LIMIT ?`).bind(owner.userId, cursor, backupPolicy.maximumPageRows + 1), "backup.page-sizes");
  const sizes: readonly RowSize[] = z.array(z.object({ cursor: safeInteger, bytes: safeInteger })).parse(metadata.results);
  const selection = selectBackupRows(sizes);
  const rows: readonly SelectedRow[] = selection.cursors.length === 0 ? [] : z.array(z.record(z.unknown()).and(z.object({ backup_cursor: safeInteger }))).parse((await snapshotRead(db, run, db.prepare(`SELECT rowid AS backup_cursor,${table.columns.map(column => quote(column.name)).join(",")} FROM ${quote(table.name)} WHERE owner_id=? AND rowid IN (${selection.cursors.map(() => "?").join(",")}) ORDER BY rowid`).bind(owner.userId, ...selection.cursors), "backup.page-rows")).results);
  if (rows.length !== selection.cursors.length || rows.some((row, i) => row.backup_cursor !== selection.cursors[i])) throw backupFailure("export-conflict", `${name}.rows`);
  const page: BackupPage = { schemaVersion: 1, backupId: recordId.parse(id), basis: run.basis, table: name, role: table.role, ordinal, cursorBefore: cursor, cursorAfter: selection.cursors.at(-1) ?? cursor, final: selection.final, rows: rows.map(row => projectBackupRow(name, row, owner.userId)) };
  const encoded: EncodedBackupPage = await encodeBackupPage(page);
  await saveBackupPage(db, run, encoded.entry);
  return encoded;
}
async function saveBackupPage(db: AtomicDatabase, run: BackupRun, entry: BackupPageEntry): Promise<void> {
  const before: string = crypto.randomUUID(); const after: string = crypto.randomUUID();
  const identity: readonly SqlValue[] = [run.basis.ownerId, run.id, entry.table, entry.ordinal];
  const values: readonly SqlValue[] = [...identity, entry.cursorBefore, entry.cursorAfter, entry.count, entry.bytes, entry.sha256, Number(entry.final)];
  const columns: string = "owner_id,backup_id,table_name,ordinal,cursor_before,cursor_after,row_count,bytes,sha256,final";
  await backupBatch(db, [backupGuard(db, before, snapshotPredicate(), snapshotParams(run)),
    db.prepare(`INSERT INTO backup_pages(${columns}) SELECT ?,?,?,?,?,?,?,?,?,? WHERE (SELECT count(*) FROM backup_pages WHERE owner_id=? AND backup_id=?) < ? AND (?=0 OR EXISTS(SELECT 1 FROM backup_pages WHERE owner_id=? AND backup_id=? AND table_name=? AND ordinal=? AND cursor_after=? AND final=0)) ON CONFLICT(owner_id,backup_id,table_name,ordinal) DO NOTHING`).bind(...values, run.basis.ownerId, run.id, backupPolicy.maximumPages, entry.ordinal, run.basis.ownerId, run.id, entry.table, entry.ordinal - 1, entry.cursorBefore),
    backupGuard(db, after, "EXISTS(SELECT 1 FROM backup_pages WHERE owner_id=? AND backup_id=? AND table_name=? AND ordinal=? AND cursor_before=? AND cursor_after=? AND row_count=? AND bytes=? AND sha256=? AND final=?)", values),
    db.prepare("UPDATE backup_pages SET acknowledged_at=NULL WHERE owner_id=? AND backup_id=? AND table_name=? AND ordinal=?").bind(...identity),
    removeGuard(db, before), removeGuard(db, after),
  ], "backup.page-save");
}

function countSql(tables: readonly BackupTable[]): string {
  return `WITH backup_owner AS (SELECT ? AS id) SELECT ${tables.map(table => `(SELECT count(*) FROM ${quote(table.name)} WHERE owner_id=(SELECT id FROM backup_owner)) AS ${quote(table.name)}`).join(",")}`;
}
function validateDatabasePages(pages: readonly BackupPageEntry[], counts: readonly BackupTableCount[]): void {
  if (pages.length > backupPolicy.maximumPages || counts.length !== backupCatalog.length || new Set(counts.map(item => item.table)).size !== backupCatalog.length) throw backupFailure("incomplete-export", "backup.counts");
  for (const table of backupCatalog) {
    const entries: readonly BackupPageEntry[] = pages.filter(page => page.table === table.name).toSorted((left, right) => left.ordinal - right.ordinal);
    let cursor: number = 0; let count: bigint = BigInt(0);
    if (entries.length === 0) throw backupFailure("incomplete-export", `${table.name}.pages`);
    for (const [ordinal, entry] of entries.entries()) {
      if (entry.ordinal !== ordinal || entry.cursorBefore !== cursor || entry.cursorAfter - cursor < entry.count || entry.final !== (ordinal === entries.length - 1) || !entry.final && entry.count === 0 || entry.count === 0 && entry.cursorAfter !== cursor) throw backupFailure("incomplete-export", `${table.name}.continuity`);
      count += BigInt(entry.count); cursor = entry.cursorAfter;
    }
    if (count !== BigInt(counts.find(item => item.table === table.name)?.rows ?? -1)) throw backupFailure("incomplete-export", `${table.name}.count`);
  }
}

/** D1 검증 완료는 전체 백업 완료가 아닙니다. R2 원본 검증 전에는 성공 매니페스트를 발급하지 않습니다. */
export async function finishBackupDatabase(db: AtomicDatabase, owner: SiteIdentity, id: string): Promise<BackupDatabaseReceipt> {
  const run: BackupRun = requireBackupCurrent(await readBackupRun(db, owner, id));
  const pageResult: D1Result = await snapshotRead(db, run, db.prepare("SELECT table_name,ordinal,cursor_before,cursor_after,row_count,bytes,sha256,final FROM backup_pages WHERE owner_id=? AND backup_id=? ORDER BY table_name,ordinal LIMIT ?").bind(owner.userId, id, backupPolicy.maximumPages + 1), "backup.pages");
  const pages: readonly BackupPageEntry[] = (pageResult.results as StoredPage[]).map(backupPageReceipt);
  const countGuard: string = crypto.randomUUID();
  const groups: readonly (readonly BackupTable[])[] = Array.from({ length: Math.ceil(backupCatalog.length / 16) }, (_, index) => backupCatalog.slice(index * 16, (index + 1) * 16));
  const countResults: D1Result[] = await backupBatch(db, [backupGuard(db, countGuard, snapshotPredicate(), snapshotParams(run)), ...groups.map(group => db.prepare(countSql(group)).bind(owner.userId)), removeGuard(db, countGuard)], "backup.counts");
  const counts: readonly BackupTableCount[] = countResults.slice(1, -1).flatMap(result => Object.entries(z.record(safeInteger).parse(z.array(z.unknown()).length(1).parse(result.results)[0])).map(([name, rows]) => ({ table: backupTable(name).name as BackupTableName, rows })));
  validateDatabasePages(pages, counts);
  const before: string = crypto.randomUUID(); const after: string = crypto.randomUUID();
  await backupBatch(db, [backupGuard(db, before, snapshotPredicate(), snapshotParams(run)),
    db.prepare("UPDATE backup_runs SET state='database-ready' WHERE owner_id=? AND id=? AND state IN ('exporting','database-ready') AND revision=?").bind(owner.userId, id, run.basis.revision),
    backupGuard(db, after, "EXISTS(SELECT 1 FROM backup_runs WHERE owner_id=? AND id=? AND state='database-ready' AND revision=?)", [owner.userId, id, run.basis.revision]), removeGuard(db, before), removeGuard(db, after),
  ], "backup.database-finish");
  return { run: { ...run, state: "database-ready" }, pages, counts };
}
export async function cancelBackup(db: AtomicDatabase, owner: SiteIdentity, id: string): Promise<BackupRun> {
  await readBackupRun(db, owner, id);
  const check: string = crypto.randomUUID();
  await backupBatch(db, [db.prepare("UPDATE backup_runs SET state='cancelled' WHERE owner_id=? AND id=? AND state IN ('exporting','database-ready','cancelled')").bind(owner.userId, id), backupGuard(db, check, "EXISTS(SELECT 1 FROM backup_runs WHERE owner_id=? AND id=? AND state='cancelled')", [owner.userId, id]), removeGuard(db, check)], "backup.cancel");
  return readBackupRun(db, owner, id);
}


/** 포함된 문장은 모두 같은 백업 기준 검사와 D1 트랜잭션으로 실행합니다. */
export async function runBackupSnapshotBatch(db: AtomicDatabase, run: BackupRun, statements: readonly D1PreparedStatement[], operation: string): Promise<D1Result[]> {
  const id: string = crypto.randomUUID();
  const result: D1Result[] = await backupBatch(db, [backupGuard(db, id, snapshotPredicate(), snapshotParams(run)), ...statements, removeGuard(db, id)], operation);
  return result.slice(1, -1);
}
