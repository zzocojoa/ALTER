import type { ReactElement, ReactNode } from "react";

/** 독립 브라우저 검사의 링크 표면입니다. 라우터 동작은 실제 앱 E2E에서 확인합니다. */
export default function FixtureLink(props: Readonly<{ href: string; children: ReactNode; className?: string; "aria-label"?: string }>): ReactElement {
  return <a {...props}/>;
}
