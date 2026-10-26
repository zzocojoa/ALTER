import { env } from "cloudflare:workers";
import type { ReactElement } from "react";
import { enrollmentEnabled } from "@/lib/enrollment-policy";
import { chatGPTSignInPath, getChatGPTUser } from "../chatgpt-auth";

export const dynamic = "force-dynamic";

export default async function OwnerSetup(): Promise<ReactElement> {
  if (!enrollmentEnabled(env.ALTER_OWNER_USER_ID, env.ALTER_OWNER_ENROLLMENT_EXPIRES_AT, new Date().getTime())) return <main className="site-shell"><h1>소유자 확인이 닫혀 있어요</h1><a href="/learn">학습 공간으로</a></main>;
  const user = await getChatGPTUser();
  if (!user) return <main className="site-shell"><h1>소유자 계정으로 로그인</h1><a href={chatGPTSignInPath("/setup")} target="_top">ChatGPT로 로그인</a></main>;
  return <main className="site-shell"><h1>내 계정 확인 요청</h1><p>현재 ChatGPT 계정을 소유자 후보로 전달합니다. 확인 요청만으로 학습 기록이나 파일에 접근할 수 없습니다.</p><form method="post" action="/api/setup/candidate"><button type="submit">이 계정 확인 요청하기</button></form></main>;
}
