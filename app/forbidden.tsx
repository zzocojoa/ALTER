import type { ReactElement } from "react";
import { chatGPTSignOutPath } from "./chatgpt-auth";

export default function Forbidden(): ReactElement {
  return <main className="site-shell"><h1>소유자만 이용할 수 있어요</h1><p>이 계정에는 학습 기록과 파일을 열 권한이 없습니다.</p><a href={chatGPTSignOutPath("/")} target="_top">로그아웃</a></main>;
}
