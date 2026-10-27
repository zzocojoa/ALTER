import { AccessHomeLink, AccessScreen } from "@/components/alter/access-screen";
import { env } from "cloudflare:workers";
import type { ReactElement } from "react";
import { enrollmentEnabled } from "@/lib/enrollment-policy";
import { chatGPTSignInPath, getChatGPTUser } from "../chatgpt-auth";

export const dynamic = "force-dynamic";

export default async function OwnerSetup(): Promise<ReactElement> {
  if (!enrollmentEnabled(env.ALTER_OWNER_USER_ID, env.ALTER_OWNER_ENROLLMENT_EXPIRES_AT, new Date().getTime())) return <AccessScreen title="소유자 확인이 닫혀 있어요" context="계정 설정" detail="새 소유자 확인 요청을 받는 기간이 아니거나 이미 소유자가 설정돼 있어요."><a className="alter-link access-primary" href="/learn">학습 공간으로</a><AccessHomeLink/></AccessScreen>;
  const user = await getChatGPTUser();
  if (!user) return <AccessScreen title="소유자 계정으로 로그인" context="계정 확인 준비" detail="로그인한 뒤 현재 계정의 소유자 확인을 요청할 수 있어요."><a className="alter-link access-primary" href={chatGPTSignInPath("/setup")} target="_top">ChatGPT로 로그인</a><AccessHomeLink/></AccessScreen>;
  return <AccessScreen title="내 계정 확인 요청" context="소유자 후보 확인" detail="현재 ChatGPT 계정을 소유자 후보로 전달합니다. 확인 요청만으로 학습 기록이나 파일에 접근할 수 없습니다."><form method="post" action="/api/setup/candidate"><button className="alter-control alter-button" data-tone="primary" type="submit">이 계정 확인 요청하기</button></form><AccessHomeLink/></AccessScreen>;
}
