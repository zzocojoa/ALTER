import { diagnosticRejection } from "@/lib/diagnostic-access";
import { siteIdentity } from "@/lib/domain/contracts";
import { env } from "cloudflare:workers";
import { ownerRejection, privateJson } from "@/lib/owner-access";
import { mutationRejection } from "@/lib/request-security";
import { requireStorageBindings } from "@/lib/storage-bindings";
import { runDataAcceptance } from "@/lib/data-acceptance";

/** 실제 사용자 자료와 격리된 서버 생성 범위에서만 원자성 검사를 실행합니다. */
export async function POST(request: Request): Promise<Response> {
  const rejection: Response | null = await ownerRejection();
  if (rejection !== null) return rejection;
  const originRejection: Response | null = mutationRejection(request.headers.get("origin"));
  if (originRejection !== null) return originRejection;
  const diagnosticBlock: Response | null = await diagnosticRejection(env.DB, siteIdentity.parse({ realm: "sites", userId: env.ALTER_OWNER_USER_ID }));
  if (diagnosticBlock !== null) return diagnosticBlock;
  const { DB } = requireStorageBindings(env);
  return privateJson(await runDataAcceptance(DB, "hosted-d1"), 200);
}
