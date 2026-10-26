import { reserveRestoreBudgetFixture } from "./restore-budget-source.ts";
import { seedUncertainRestoreSource } from "./restore-uncertain-source.ts";
import { checkRestoreGoogleConsent } from "./restore-google-consent.ts";
import { readLearningDashboard } from "../../db/repositories/dashboard.ts";
import { readUsageDashboard } from "../../db/repositories/dashboard-usage.ts";
import { activateRestore } from "../../db/repositories/restore-activation.ts";
import { readRestoredExecution, requireCurrentExecutionAuthority } from "../../db/repositories/restore-execution.ts";
import originalWorker, { initializeRestoreFixture } from "./restore-original-worker.ts";
import weeklyWorker from "./weekly-worker.ts";
import { beginRestoreVerification, verifyRestorePage, verifyRestoreOriginal, finishRestoreVerification } from "../../db/repositories/restore-verification.ts";
import { beginRestoreImport, importRestorePage } from "../../db/repositories/restore-import.ts";
import type { AtomicDatabase } from "../../db/repositories/atomic.ts";
import type { StorageContext } from "../../lib/backup/storage-identity.ts";

type Environment = Readonly<{ DB: D1Database; BUCKET: R2Bucket; TARGET: D1Database; TARGET_BUCKET: R2Bucket; STRESS_BUCKET: R2Bucket }>;
function faultyDatabase(db: D1Database, fault: string): AtomicDatabase {
  return { prepare: db.prepare.bind(db), async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    if (fault === "rollback") return db.batch([...statements, db.prepare("INSERT INTO backup_checks(id,matched) VALUES ('import-fault',0)")]);
    const result = await db.batch<T>(statements); if (fault === "lost-response") throw new Error("network: fixture import committed response lost"); return result;
  } };
}
async function run(request: Request, env: Environment): Promise<Response> {
  const url = new URL(request.url); const id: string = url.searchParams.get("id") ?? "";
  const context: StorageContext = { projectId: "isolated-restore-project", owner: { realm: "sites", userId: url.searchParams.get("targetOwner") ?? "restored-worker-owner" } };
  if (url.pathname === "/learning-seed") return weeklyWorker.fetch(request, env);
  if (url.pathname === "/restore/init") return initializeRestoreFixture(env, { projectId: "local-backup-project", owner: { realm: "sites", userId: url.searchParams.get("owner") ?? "" } }, context, url.searchParams.get("backupId") ?? "", id);
  const owner = { realm: "sites" as const, userId: url.searchParams.get("owner") ?? context.owner.userId };
  const db = faultyDatabase(env.TARGET, url.searchParams.get("fault") ?? "");
  if (url.pathname === "/restore/budget-fixture") { await reserveRestoreBudgetFixture(env.DB, { realm: "sites", userId: url.searchParams.get("owner") ?? "" }, url.searchParams.get("businessKey") ?? "", Number(url.searchParams.get("usdMicros")), Date.now()); return Response.json({ reserved: true }); }
  if (url.pathname === "/restore/seed-uncertain") { await seedUncertainRestoreSource(env.DB, { realm: "sites", userId: url.searchParams.get("owner") ?? "" }, Date.now()); return Response.json({ seeded: true }); }
  if (url.pathname === "/restore/consent-check") return Response.json(await checkRestoreGoogleConsent(env.TARGET, owner, Date.now()));
  if (url.pathname === "/restore/dashboard") return Response.json(await readLearningDashboard(env.TARGET, env.TARGET_BUCKET, owner, Date.now()));
  if (url.pathname === "/restore/usage") return Response.json(await readUsageDashboard(env.TARGET, owner, undefined, Date.now()));
  if (url.pathname === "/restore/activate") return Response.json(await activateRestore(db, env.TARGET_BUCKET, context, owner, id, Date.now()));
  if (url.pathname === "/restore/access") return Response.json(await readRestoredExecution(db, owner));
  if (url.pathname === "/restore/execution") { await requireCurrentExecutionAuthority(db, owner); return Response.json({ allowed: true }); }
  if (url.pathname === "/restore/import") return Response.json(await beginRestoreImport(db, env.TARGET_BUCKET, context, owner, id, Date.now()));
  if (url.pathname === "/restore/import-page") return Response.json(await importRestorePage(db, env.TARGET_BUCKET, context, owner, id, url.searchParams.get("path") ?? "", Date.now()));
  if (url.pathname === "/restore/verify") return Response.json(await beginRestoreVerification(db, env.TARGET_BUCKET, context, owner, id, Date.now()));
  if (url.pathname === "/restore/verify-page") return Response.json(await verifyRestorePage(db, env.TARGET_BUCKET, context, owner, id, url.searchParams.get("path") ?? "", Date.now()));
  if (url.pathname === "/restore/verify-original") return Response.json(await verifyRestoreOriginal(db, env.TARGET_BUCKET, context, owner, id, Number(url.searchParams.get("ordinal")), Date.now(), request.signal));
  if (url.pathname === "/restore/verify-complete") return Response.json(await finishRestoreVerification(db, env.TARGET_BUCKET, context, owner, id, Date.now()));
  return originalWorker.fetch(request, env);
}
const worker = { async fetch(request: Request, env: Environment): Promise<Response> {
  try { return await run(request, env); }
  catch (error: unknown) { if (!(error instanceof Error)) throw error; return Response.json({ message: error.message, code: "code" in error ? error.code : null, operation: "operation" in error ? error.operation : null, cause: error.cause instanceof Error ? error.cause.message : null }, { status: 409 }); }
} };
export default worker;
