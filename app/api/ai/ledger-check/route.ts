import { diagnosticRejection } from "@/lib/diagnostic-access";
import { siteIdentity } from "@/lib/domain/contracts";
import { env } from "cloudflare:workers";
import { ownerRejection, privateJson } from "@/lib/owner-access";
import { mutationRejection } from "@/lib/request-security";
import { runAiLedgerAcceptance } from "@/lib/ai/ledger-acceptance";

/** 인증된 소유자의 동일 출처 요청만 서버 생성 검사 범위에서 실행합니다. */
export async function POST(request: Request): Promise<Response> {
  const rejection: Response | null = await ownerRejection();
  if (rejection !== null) return rejection;
  const originRejection: Response | null = mutationRejection(request.headers.get("origin"));
  if (originRejection !== null) return originRejection;
  const diagnosticBlock: Response | null = await diagnosticRejection(env.DB, siteIdentity.parse({ realm: "sites", userId: env.ALTER_OWNER_USER_ID }));
  if (diagnosticBlock !== null) return diagnosticBlock;
  return privateJson(await runAiLedgerAcceptance(env.DB, "hosted-d1"), 200);
}
