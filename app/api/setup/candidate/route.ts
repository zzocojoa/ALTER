import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { enrollmentEnabled } from "@/lib/enrollment-policy";
import { privateJson } from "@/lib/owner-access";
import { mutationRejection } from "@/lib/request-security";
import { requireStorageBindings } from "@/lib/storage-bindings";

/** 확인된 소유자 전용 Sites에서만 한시적으로 사용합니다. 자동 소유자 등록은 하지 않습니다. */
export async function POST(request: Request): Promise<Response> {
  if (!enrollmentEnabled(env.ALTER_OWNER_USER_ID, env.ALTER_OWNER_ENROLLMENT_EXPIRES_AT, Date.now())) return privateJson({ error: "enrollment_closed" }, 404);
  const originRejection: Response | null = mutationRejection(request.headers.get("origin"));
  if (originRejection) return originRejection;
  const user = await getChatGPTUser();
  if (!user) return privateJson({ error: "authentication_required" }, 401);
  const { DB } = requireStorageBindings(env);
  const result = await DB.prepare("INSERT INTO owner_enrollment (slot, user_id, requested_at) VALUES (1, ?, ?) ON CONFLICT(slot) DO UPDATE SET requested_at = excluded.requested_at WHERE owner_enrollment.user_id = excluded.user_id RETURNING slot").bind(user.userId, Date.now()).first<{ slot: number }>();
  if (!result) return privateJson({ error: "different_candidate_already_recorded" }, 409);
  return privateJson({ requested: true, accessGranted: false, candidateId: user.userId, message: "확인 요청을 저장했습니다. 승인 전에는 학습 데이터에 접근할 수 없습니다." }, 202);
}
