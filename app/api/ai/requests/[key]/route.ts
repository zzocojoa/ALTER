import { env } from "cloudflare:workers";
import { z } from "zod";
import { readAiRequestStatus } from "@/db/repositories/ai-status";
import { isDomainFailure } from "@/db/repositories/atomic";
import { ownerRejection, privateJson } from "@/lib/owner-access";
import { siteIdentity } from "@/lib/domain/contracts";

export const dynamic = "force-dynamic";

/** GET은 저장된 상태만 조회하고 키·모델 호출·재생성을 실행하지 않습니다. */
export async function GET(_request: Request, context: { params: Promise<{ key: string }> }): Promise<Response> {
  const rejection: Response | null = await ownerRejection();
  if (rejection) return rejection;
  const key = z.string().min(1).max(180).safeParse((await context.params).key);
  if (!key.success) return privateJson({ error: "ai_request_key_invalid" }, 400);
  try {
    const requests = await readAiRequestStatus(env.DB, siteIdentity.parse({ realm: "sites", userId: env.ALTER_OWNER_USER_ID }), key.data);
    return privateJson({ requests, automaticReplayAllowed: false }, requests.length === 0 ? 404 : 200);
  } catch (error: unknown) {
    if (isDomainFailure(error)) return privateJson({ error: error.code, operation: error.operation }, 503);
    throw error;
  }
}
