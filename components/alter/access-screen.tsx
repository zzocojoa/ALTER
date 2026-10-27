import type { ReactElement, ReactNode } from "react";
import { PageHeader } from "./page-header";
import "@/app/styles/access.css";

/** 접근 안내는 원문 오류를 숨기고 일반 문서 이동으로 현재 서버 권한을 다시 확인합니다. */
export function AccessScreen({ title, context, detail, children }: Readonly<{ title: string; context: string; detail: string; children: ReactNode }>): ReactElement {
  return <main data-alter-ui className="site-shell access-screen">
    {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- 접근 안내에서 나갈 때 서버와 인증 상태를 새 문서로 확인합니다. */}
    <a className="wordmark alter-link" href="/" aria-label="ALTER 시작 화면">ALTER<span aria-hidden="true">.</span></a><section className="access-card"><PageHeader title={title} context={context} back={null} action={null}/><p className="alter-body">{detail}</p><div className="access-actions">{children}</div></section></main>;
}

/** 오류·설정 안내에서 빠져나갈 때 클라이언트 라우터 상태를 재사용하지 않습니다. */
export function AccessHomeLink(): ReactElement {
  // eslint-disable-next-line @next/next/no-html-link-for-pages -- 접근 안내에서 나갈 때 서버와 인증 상태를 새 문서로 확인합니다.
  return <a className="alter-link" href="/">시작 화면으로</a>;
}
