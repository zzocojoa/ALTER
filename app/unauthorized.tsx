import Link from "next/link";
import type { ReactElement } from "react";
import { AccessScreen } from "@/components/alter/access-screen";
import { chatGPTSignInPath } from "./chatgpt-auth";
export default function Unauthorized(): ReactElement {
  return <AccessScreen title="내 학습 공간에 로그인" context="로그인이 필요해요" detail="학습 기록과 파일은 소유자만 열 수 있어요."><a className="alter-link access-primary" href={chatGPTSignInPath("/learn")} target="_top">ChatGPT로 로그인</a><Link className="alter-link" href="/">시작 화면으로</Link></AccessScreen>;
}
