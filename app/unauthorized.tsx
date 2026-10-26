import type { ReactElement } from "react";
import { chatGPTSignInPath } from "./chatgpt-auth";

export default function Unauthorized(): ReactElement {
  return <main className="site-shell"><h1>내 학습 공간에 로그인</h1><p>학습 기록과 파일은 소유자만 열 수 있어요.</p><a href={chatGPTSignInPath("/learn")} target="_top">ChatGPT로 로그인</a></main>;
}
