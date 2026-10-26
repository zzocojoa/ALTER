import { z } from "zod";
import { env } from "cloudflare:workers";
import { siteIdentity } from "../domain/contracts";
import type { SiteIdentity } from "../domain/contracts";
import { getOwnerDecision, privateJson } from "../owner-access";
import { mutationRejection } from "../request-security";
import { isDomainFailure } from "../../db/repositories/atomic";
import type { MaterialFailure } from "./policy";

export type MaterialOwnerAccess = Readonly<{ owner: SiteIdentity; rejection: null }> | Readonly<{ owner: null; rejection: Response }>;

/** 서버의 Sites 신원을 확인한 뒤에만 요청 소유자를 만듭니다. */
export async function materialOwnerAccess(): Promise<MaterialOwnerAccess> {
  const decision = await getOwnerDecision();
  if (decision.kind === "restore-quarantined") return { owner: null, rejection: privateJson({ error: "restore_quarantined", message: "복원 검증이 끝날 때까지 학습과 외부 연동이 잠겨 있어요." }, 423) };
  if (decision.kind !== "owner") return { owner: null, rejection: privateJson({ error: decision.kind === "unauthenticated" ? "authentication_required" : decision.kind === "forbidden" ? "owner_access_required" : "authentication_configuration_required" }, decision.kind === "unauthenticated" ? 401 : decision.kind === "forbidden" ? 403 : 503) };
  return { owner: siteIdentity.parse({ realm: "sites", userId: env.ALTER_OWNER_USER_ID }), rejection: null };
}

/** 시작·전송·완료·복구·정리 요청이 동일한 인증·출처 방어를 사용합니다. */
export async function materialMutationAccess(request: Request): Promise<MaterialOwnerAccess> {
  const access: MaterialOwnerAccess = await materialOwnerAccess();
  if (access.rejection !== null) return access;
  const rejection: Response | null = mutationRejection(request.headers.get("origin"));
  return rejection === null ? access : { owner: null, rejection };
}

export function materialErrorResponse(error: unknown): Response {
  if (error instanceof Error && error.name === "RestoreExecutionFailure" && "code" in error && error.code === "restore_execution_unverified") return privateJson({ error: error.code, message: error.message }, 423);
  if (error instanceof z.ZodError) return privateJson({ error: "material_request_invalid", field: error.issues[0].path.join(".") }, 400);
  if (error instanceof Error && error.name === "MaterialFailure" && "code" in error && "status" in error && "field" in error) {
    const failure = error as MaterialFailure;
    return privateJson({ error: failure.code, field: failure.field }, failure.status);
  }
  if (isDomainFailure(error) && error.operation === "material.transfer.get" && error.code === "reference_conflict") return privateJson({ error: "material_not_found" }, 404);
  if (isDomainFailure(error) && error.operation === "material.usage" && error.code === "reference_conflict") return privateJson({ error: "material_runtime_unverified", field: "storage-inventory" }, 503);
  if (isDomainFailure(error)) return privateJson({ error: error.code, operation: error.operation }, ["storage_failure", "result_unknown"].includes(error.code) ? 503 : 409);
  throw error;
}
