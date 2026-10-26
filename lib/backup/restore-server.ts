import { isDomainFailure } from "../../db/repositories/atomic";
import { env } from "cloudflare:workers";
import { z } from "zod";
import hosting from "../../.openai/hosting.json";
import { getAuthenticatedOwnerDecision, privateJson } from "../owner-access";
import { mutationRejection } from "../request-security";
import { siteIdentity } from "../domain/contracts";
import type { SiteIdentity } from "../domain/contracts";
import { backupErrorResponse } from "./server";
import { readRestoreConfiguration } from "./restore-configuration";
import type { RestoreConfiguration } from "./restore-configuration";
import { restoreAuthorityFailure } from "./restore-authority";
import type { RestoreAuthorityFailure } from "./restore-authority";
import type { StorageContext } from "./storage-identity";

type RestoreAccess = Readonly<{ owner: SiteIdentity; context: StorageContext; configuration: RestoreConfiguration; rejection: null }> | Readonly<{ owner: null; context: null; configuration: null; rejection: Response }>;
/** 복원 관리도 서버에서 확인한 소유자와 동일 출처 요청에만 허용합니다. */
export async function restoreOwnerAccess(): Promise<RestoreAccess> {
  const decision = await getAuthenticatedOwnerDecision();
  if (decision.kind !== "owner") return { owner: null, context: null, configuration: null, rejection: privateJson({ error: decision.kind === "unauthenticated" ? "authentication_required" : decision.kind === "forbidden" ? "owner_access_required" : "authentication_configuration_required" }, decision.kind === "unauthenticated" ? 401 : decision.kind === "forbidden" ? 403 : 503) };
  const configuration = readRestoreConfiguration(env.ALTER_RESTORE_CONFIGURATION);
  if (configuration === null) throw restoreAuthorityFailure("invalid-authorization", "ALTER_RESTORE_CONFIGURATION");
  const owner = siteIdentity.parse({ realm: "sites", userId: env.ALTER_OWNER_USER_ID });
  return { owner, context: { projectId: hosting.project_id, owner }, configuration, rejection: null };
}
export async function restoreMutationAccess(request: Request): Promise<RestoreAccess> {
  const access = await restoreOwnerAccess(); if (access.rejection !== null) return access;
  const rejection = mutationRejection(request.headers.get("origin"));
  return rejection === null ? access : { owner: null, context: null, configuration: null, rejection };
}
export function restoreErrorResponse(error: unknown): Response {
  if (error instanceof z.ZodError) return privateJson({ error: "restore_request_invalid", field: error.issues[0].path.join(".") }, 400);
  if (error instanceof Error && error.name === "RestoreAuthorityFailure" && "code" in error && "field" in error) { const failure = error as RestoreAuthorityFailure; return privateJson({ error: failure.code, field: failure.field, message: failure.message }, failure.code === "wrong-owner" ? 403 : 409); }
  if (isDomainFailure(error)) {
    const cause: unknown = error.cause;
    const message: string = cause instanceof Error ? cause.message : "";
    const reason: string = /CHECK constraint|FOREIGN KEY constraint|UNIQUE constraint|NOT NULL constraint|too many SQL variables|too many subrequests|too many SQL statements|not authorized|no such table: [a-z_][a-z0-9_]*|no such column: [a-z_][a-z0-9_]*|SQLITE_[A-Z_]+|HTTP [0-9]{3}|D1_ERROR|network|timeout|not supported/i.exec(message)?.[0] ?? "unclassified";
    console.error({ event: "restore_storage_failure", operation: error.operation, code: error.code, causeType: cause instanceof Error ? cause.name : typeof cause, reason });
  }
  return backupErrorResponse(error);
}
