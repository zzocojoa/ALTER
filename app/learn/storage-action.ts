"use server";

import { headers } from "next/headers";
import { ownerRejection } from "@/lib/owner-access";
import { mutationRejection } from "@/lib/request-security";

/** 직접 서버 작업을 호출해도 인증·출처를 확인한 후에 저장소를 검사합니다. */
export async function checkStorageAction(): Promise<void> {
  const rejection: Response | null = await ownerRejection();
  if (rejection) throw new Error(`저장소 검사 권한 거부: HTTP ${rejection.status}`);
  const originRejection: Response | null = mutationRejection((await headers()).get("origin"));
  if (originRejection) throw new Error(`저장소 검사 출처 거부: HTTP ${originRejection.status}`);
  throw new Error("이전 저장소 진단은 종료됐어요. 자료 보관함에서 저장 공간 확인을 실행해 주세요. HTTP 410");
}
