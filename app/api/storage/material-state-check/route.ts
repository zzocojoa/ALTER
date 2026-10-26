import { env } from "cloudflare:workers";
import { ownerRejection, privateJson } from "@/lib/owner-access";
import { mutationRejection } from "@/lib/request-security";
import { requireStorageBindings } from "@/lib/storage-bindings";
import { runMaterialStateAcceptance } from "@/lib/materials/state-acceptance";

/** 실제 소유자 자료와 격리된 DB 상태 검사를 실행하고 해당 검사 행만 정리합니다. */
export async function POST(request: Request): Promise<Response> {
  const rejection: Response | null = await ownerRejection();
  if (rejection !== null) return rejection;
  const originRejection: Response | null = mutationRejection(request.headers.get("origin"));
  if (originRejection !== null) return originRejection;
  const { DB } = requireStorageBindings(env);
  return privateJson(await runMaterialStateAcceptance(DB, "hosted-d1"), 200);
}
