import { z } from "zod";
import { command, contentHash, domainFailure, recordId } from "../../lib/domain/contracts.ts";
import type { Command, DomainFailure, FailureCode } from "../../lib/domain/contracts.ts";

export type AtomicDatabase = Pick<D1Database, "prepare" | "batch">;
export type SqlValue = string | number | null;
export type Receipt = Readonly<{ entityId: string; version: number; requestId: string }>;
export type AtomicPlan = (requestId: string) => readonly D1PreparedStatement[];
type StoredRequest = Readonly<{ content_hash: string; result_json: string }>;
export const mutableTables = ["courses", "units", "plans", "plan_drafts", "materials", "uploads", "sessions", "attempts", "answer_drafts", "learning_results", "errors", "review_items", "weekly_summaries", "weekly_drafts", "google_connections", "google_tokens", "external_jobs", "external_steps", "cost_windows", "cost_reservations", "quota_windows", "quota_reservations", "ai_calls", "material_inventory", "material_transfers", "extraction_jobs", "extraction_pages", "advisor_sessions", "study_scopes", "tutor_sessions", "review_plans", "review_schedule", "google_runtime", "external_workflows", "external_operations"] as const;
export type MutableTable = typeof mutableTables[number];
const receiptSchema = z.object({ entityId: recordId, version: z.number().int().positive(), requestId: recordId }).strict();

/** SQL 제약 위반은 재시도하지 않고, 연결 장애만 제한적으로 재시도합니다. */
export async function readStorage<T>(operation: string, read: () => Promise<T>): Promise<T> {
  for (let attempt: number = 1; attempt <= 3; attempt += 1) {
    try { return await read(); }
    catch (error: unknown) {
      if (attempt === 3 || !isTransient(error)) throw domainFailure("storage_failure", operation, error);
      console.warn({ event: "storage_read_retry", operation, attempt, errorType: error instanceof Error ? error.name : "unknown" });
    }
  }
  throw domainFailure("storage_failure", operation, null);
}

function isTransient(error: unknown): boolean {
  return error instanceof Error && /network|timeout|overloaded|temporarily|internal error|reset|fetch failed/i.test(error.message);
}

function classifyFailure(error: unknown): FailureCode {
  if (!(error instanceof Error)) return "storage_failure";
  if (/atomic_checks_check_0/.test(error.message)) return "version_conflict";
  if (/cost_windows_check|quota_windows_check/.test(error.message)) return "limit_exceeded";
  if (/FOREIGN KEY|UNIQUE constraint|CHECK constraint|NOT NULL|SQLITE_CONSTRAINT|immutable|invalid_|ABORT/i.test(error.message)) return "reference_conflict";
  return "storage_failure";
}

function replay(stored: StoredRequest, hash: string, operation: string): Receipt {
  if (stored.content_hash !== hash) throw domainFailure("request_key_reused", operation, null);
  return receiptSchema.parse(JSON.parse(stored.result_json));
}

/** 현재 버전을 읽기 전에 완료된 동일 요청을 확인합니다. */
export async function readAtomicReceipt(db:AtomicDatabase,input:Command,scope:string,payload:unknown,entityId:string):Promise<Receipt|null> {
  command.parse(input);recordId.parse(entityId);
  const hash=await contentHash({payload,entityId,expectedVersion:input.expectedVersion});
  const stored=await readStorage(scope,()=>db.prepare("SELECT content_hash,result_json FROM atomic_requests WHERE owner_id=? AND scope=? AND request_key=?").bind(input.owner.userId,scope,input.requestKey).first<StoredRequest>());
  return stored ? replay(stored,hash,scope) : null;
}

/** 요청 INSERT와 0행 검증을 같은 D1 batch에 넣어 전체 성공 또는 전체 롤백만 허용합니다. */
export async function executeAtomic(db: AtomicDatabase, input: Command, scope: string, payload: unknown, entityId: string, nextVersion: number, plan: AtomicPlan): Promise<Receipt> {
  command.parse(input); recordId.parse(entityId);
  const hash: string = await contentHash({ payload, entityId, expectedVersion: input.expectedVersion });
  const lookup = (): Promise<StoredRequest | null> => db.prepare("SELECT content_hash, result_json FROM atomic_requests WHERE owner_id = ? AND scope = ? AND request_key = ?").bind(input.owner.userId, scope, input.requestKey).first<StoredRequest>();
  const previous: StoredRequest | null = await readStorage(scope, lookup);
  if (previous !== null) return replay(previous, hash, scope);
  for (let attempt: number = 1; attempt <= 3; attempt += 1) {
    const requestId: string = crypto.randomUUID();
    const receipt: Receipt = receiptSchema.parse({ entityId, version: nextVersion, requestId });
    const statements: readonly D1PreparedStatement[] = plan(requestId);
    if (statements.length === 0) throw domainFailure("validation", scope, null);
    try {
      await db.batch([
        db.prepare("INSERT INTO atomic_requests (owner_id,id,scope,request_key,content_hash,result_json,created_at) VALUES (?,?,?,?,?,?,?)").bind(input.owner.userId, requestId, scope, input.requestKey, hash, JSON.stringify(receipt), Date.now()),
        ...statements,
      ]);
      return receipt;
    } catch (error: unknown) {
      let stored: StoredRequest | null;
      try { stored = await readStorage(scope, lookup); }
      catch (lookupError: unknown) { throw domainFailure("result_unknown", scope, new AggregateError([error, lookupError], "저장 결과 조회도 실패했습니다.")); }
      if (stored !== null) return replay(stored, hash, scope);
      if (attempt === 3 || !isTransient(error)) throw domainFailure(classifyFailure(error), scope, error);
      console.warn({ event: "atomic_retry_after_reconciliation", operation: scope, attempt, errorType: error instanceof Error ? error.name : "unknown" });
    }
  }
  throw domainFailure("storage_failure", scope, null);
}

/** 갱신 직후 무조건 검사 행을 INSERT합니다. 조건부 INSERT나 OR IGNORE를 사용하지 않습니다. */
export function guardedUpdate(db: AtomicDatabase, table: MutableTable, ownerId: string, id: string, expectedVersion: number, requestId: string, step: number, assignments: string, values: readonly SqlValue[], condition: string, conditions: readonly SqlValue[]): readonly [D1PreparedStatement, D1PreparedStatement] {
  if (!mutableTables.includes(table)) throw domainFailure("validation", "guardedUpdate", null);
  return [
    db.prepare(`UPDATE ${table} SET ${assignments}, version = version + 1, last_request_id = ? WHERE owner_id = ? AND id = ? AND version = ? AND (${condition})`).bind(...values, requestId, ownerId, id, expectedVersion, ...conditions),
    db.prepare(`INSERT INTO atomic_checks (owner_id,id,request_id,step,matched) VALUES (?,?,?,?,CASE WHEN EXISTS(SELECT 1 FROM ${table} WHERE owner_id = ? AND id = ? AND version = ? AND last_request_id = ?) THEN 1 ELSE 0 END)`).bind(ownerId, crypto.randomUUID(), requestId, step, ownerId, id, expectedVersion + 1, requestId),
  ];
}

/** 조건 자체를 검사할 때도 생략되지 않는 INSERT를 사용합니다. */
export function requireInBatch(db: AtomicDatabase, ownerId: string, requestId: string, step: number, predicate: string, values: readonly SqlValue[]): D1PreparedStatement {
  return db.prepare(`INSERT INTO atomic_checks (owner_id,id,request_id,step,matched) VALUES (?,?,?,?,CASE WHEN (${predicate}) THEN 1 ELSE 0 END)`).bind(ownerId, crypto.randomUUID(), requestId, step, ...values);
}

export function isDomainFailure(error: unknown): error is DomainFailure {
  return error instanceof Error && "code" in error && "operation" in error;
}
