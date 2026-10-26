import { readRestoredExecution } from "../db/repositories/restore-execution";
import { siteIdentity } from "./domain/contracts";
import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../app/chatgpt-auth";
import { readRestoreConfiguration } from "./backup/restore-configuration";
import { decideOwner } from "./auth-policy";
import type { OwnerDecision } from "./auth-policy";

/** Sites dispatch를 통과한 서버 helper만 사용하며 본문·쿠키에서 신원을 읽지 않습니다. */
export async function getAuthenticatedOwnerDecision(): Promise<OwnerDecision> {
  return decideOwner(await getChatGPTUser(), env.ALTER_OWNER_USER_ID, env.ALTER_LOCAL_MOCK_AUTH);
}

/** 설정과 영속 복원 상태를 함께 확인하며 명시적으로 활성화된 학습만 허용합니다. */
export async function getOwnerDecision(): Promise<OwnerDecision> {
  const decision = await getAuthenticatedOwnerDecision();
  if (decision.kind !== "owner") return decision;
  try {
    const configuration = readRestoreConfiguration(env.ALTER_RESTORE_CONFIGURATION);
    const restored = await readRestoredExecution(env.DB, siteIdentity.parse({ realm: "sites", userId: env.ALTER_OWNER_USER_ID }));
    return restored?.learning === "quarantined" || configuration?.role === "restore-test" && restored?.learning !== "active" ? { kind: "restore-quarantined" } : decision;
  }
  catch (error: unknown) { if (error instanceof Error && error.name === "RestoreAuthorityFailure") return { kind: "configuration-error", setting: "ALTER_RESTORE_CONFIGURATION" }; throw error; }
}

/** 호출자는 실패 응답을 즉시 반환한 뒤에만 저장소·외부 서비스를 이용할 수 있습니다. */
export async function ownerRejection(): Promise<Response | null> {
  const decision: OwnerDecision = await getOwnerDecision();
  switch (decision.kind) {
    case "owner": return null;
    case "restore-quarantined": return privateJson({ error: "restore_quarantined", message: "복원 검증이 끝날 때까지 학습과 외부 연동이 잠겨 있어요." }, 423);
    case "unauthenticated": return privateJson({ error: "authentication_required" }, 401);
    case "forbidden": return privateJson({ error: "owner_access_required" }, 403);
    case "configuration-error": return privateJson({ error: "authentication_configuration_required", setting: decision.setting }, 503);
  }
}

export function privateJson(body: object, status: number): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff" } });
}
