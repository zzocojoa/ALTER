import type { ReactElement, ReactNode } from "react";

/** 키보드가 열려도 문서 흐름 안에서 스크롤로 도달하는 행동 영역입니다. */
export function ActionBar({ label, children }: Readonly<{ label: string; children: ReactNode }>): ReactElement {
  return <div className="alter-action-bar" role="group" aria-label={label}>{children}</div>;
}
