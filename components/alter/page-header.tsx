"use client";

import { useEffect, useRef, type ReactElement, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

export type PageReturn = Readonly<{ href: string; label: string }>;

/** 직접 진입해도 안전한 내부 목적지를 사용하고 기존 해시와 브라우저 복귀 위치를 우선합니다. */
export function PageHeader({ title, context, back, action }: Readonly<{ title: string; context: string; back: PageReturn | null; action: ReactNode }>): ReactElement {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect((): void => {
    if (location.hash !== "" || window.scrollY > 0 || document.activeElement !== document.body) return;
    heading.current?.focus({ preventScroll: true });
  }, []);
  return <header className="alter-page-header">
    {back === null ? null : <a className="alter-link alter-page-back" href={back.href}><ArrowLeft className="alter-icon" aria-hidden="true" /><span>{back.label}</span></a>}
    <div className="alter-page-heading"><div><p className="alter-caption">{context}</p><h1 id="learn-title" className="alter-heading" ref={heading} tabIndex={-1}>{title}</h1></div>{action === null ? null : <div className="alter-page-action">{action}</div>}</div>
  </header>;
}
