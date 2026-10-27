import Link from "next/link";
import type { ReactElement, ReactNode } from "react";
import { PageHeader } from "./page-header";
import "@/app/styles/access.css";

/** 공개·접근 제한·오류 화면은 계정이나 원문 오류 데이터 없이 다음 행동만 보여 줍니다. */
export function AccessScreen({ title, context, detail, children }: Readonly<{ title: string; context: string; detail: string; children: ReactNode }>): ReactElement {
  return <main data-alter-ui className="site-shell access-screen"><Link className="wordmark alter-link" href="/" aria-label="ALTER 시작 화면">ALTER<span aria-hidden="true">.</span></Link><section className="access-card"><PageHeader title={title} context={context} back={null} action={null}/><p className="alter-body">{detail}</p><div className="access-actions">{children}</div></section></main>;
}
