import { env } from "cloudflare:workers";
import { getTutor } from "@/db/repositories/tutor";
import { recordId } from "@/lib/domain/contracts";
import { materialOwnerAccess } from "@/lib/materials/server-access";
import { privateJson } from "@/lib/owner-access";
import { prepareScheduledReviewApproval } from "@/lib/reviews/scheduled-acceptance";
import { requireCurrentTutor } from "@/lib/tutor/current";
import { tutorErrorResponse } from "@/lib/tutor/server";

/** 소유자에게 검증 후보 지문만 반환하며 숨긴 교재·정답·키·실행 승인을 노출하지 않습니다. */
export async function GET(request: Request): Promise<Response> {
  const access = await materialOwnerAccess();
  if (access.rejection) return access.rejection;
  try {
    const id: string = recordId.parse(new URL(request.url).searchParams.get("id"));
    const state = await getTutor(env.DB, access.owner, id);
    await requireCurrentTutor(env.DB, env.BUCKET, access.owner, state);
    const now: number = Date.now();
    const approval = await prepareScheduledReviewApproval(state, now, now + 3_600_000);
    return privateJson({ approval, savedVersion: state.version, answerId: state.currentAnswerId, configured: false }, 200);
  } catch (error: unknown) { return tutorErrorResponse(error); }
}
