import { env } from "cloudflare:workers";
import { recordId } from "@/lib/domain/contracts";
import { materialMutationAccess, materialOwnerAccess } from "@/lib/materials/server-access";
import { readBoundedJson } from "@/lib/materials/request";
import { privateJson } from "@/lib/owner-access";
import { googleApiServerSettings, googleErrorResponse, googleExecutionRuntime } from "@/lib/google/server";
import { readRestoreReconciliation } from "@/db/repositories/restore-reconciliation";
import { restoreReconciliationInput, restoreReconciliationView } from "@/lib/backup/reconciliation";
import { reconcileRestoredOperation } from "@/lib/backup/reconcile";
export const dynamic = "force-dynamic";
export async function GET(request: Request): Promise<Response> {
  const access = await materialOwnerAccess(); if (access.rejection) return access.rejection;
  try {
    const row = await readRestoreReconciliation(env.DB, access.owner, recordId.parse(new URL(request.url).searchParams.get("id")));
    return row === null ? privateJson({ error: "restore_reconciliation_not_found" }, 404) : privateJson(restoreReconciliationView(row), 200);
  } catch (error: unknown) { return googleErrorResponse(error); }
}
export async function POST(request: Request): Promise<Response> {
  const access = await materialMutationAccess(request); if (access.rejection) return access.rejection;
  try {
    const input = restoreReconciliationInput.parse(await readBoundedJson(request, 2048));
    const settings = googleApiServerSettings(access.owner);
    return privateJson(restoreReconciliationView(await reconcileRestoredOperation(env.DB, access.owner, input, settings.execution, googleExecutionRuntime().rest)), 200);
  } catch (error: unknown) { return googleErrorResponse(error); }
}
