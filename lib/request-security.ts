import { env } from "cloudflare:workers";
import { requireSameOrigin } from "./auth-policy";
import { privateJson } from "./owner-access";

/** API와 서버 작업의 Origin 검증 결과를 값이나 토큰 없이 응답합니다. */
export function mutationRejection(origin: string | null): Response | null {
  try {
    requireSameOrigin(origin, env.ALTER_SITE_ORIGIN);
    return null;
  } catch (error) {
    if (error instanceof DOMException && error.name === "SecurityError") return privateJson({ error: "same_origin_required" }, 403);
    if (error instanceof TypeError) return privateJson({ error: "site_origin_configuration_required" }, 503);
    throw error;
  }
}
