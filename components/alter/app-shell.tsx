"use client";

import type { ReactElement, ReactNode } from "react";
import { usePathname } from "next/navigation";
import { SessionBoundary } from "./session-boundary";
import { ShellFrame } from "./shell-frame";

/** 소유자 판정이 끝난 서버 레이아웃만 이 셸을 렌더링합니다. */
export function AppShell({ children }: Readonly<{ children: ReactNode }>): ReactElement {
  const pathname: string = usePathname();
  return <SessionBoundary><ShellFrame pathname={pathname}>{children}</ShellFrame></SessionBoundary>;
}
