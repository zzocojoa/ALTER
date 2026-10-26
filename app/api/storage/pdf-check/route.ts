import { privateJson } from "@/lib/owner-access";
import { materialMutationAccess } from "@/lib/materials/server-access";

/** 용량 예약을 거치지 않는 이전 진단 쓰기를 종료하고 자료 보관함의 실측 검사로 통합합니다. */
export async function POST(request: Request): Promise<Response> {
  const access = await materialMutationAccess(request);
  if (access.rejection !== null) return access.rejection;
  return privateJson({ error: "legacy_storage_probe_retired", replacement: "/learn/materials" }, 410);
}
