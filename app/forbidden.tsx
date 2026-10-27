import Link from "next/link";
import type { ReactElement } from "react";
import { AccessScreen } from "@/components/alter/access-screen";
import { chatGPTSignOutPath } from "./chatgpt-auth";
export default function Forbidden(): ReactElement {
  return <AccessScreen title="소유자만 이용할 수 있어요" context="접근 권한이 없어요" detail="이 계정에는 학습 기록과 파일을 열 권한이 없습니다. 다른 계정을 사용하려면 먼저 로그아웃해 주세요."><a className="alter-link access-primary" href={chatGPTSignOutPath("/")} target="_top">로그아웃</a><Link className="alter-link" href="/">시작 화면으로</Link></AccessScreen>;
}
