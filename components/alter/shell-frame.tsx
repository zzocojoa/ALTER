"use client";

import { useState, type ReactElement, type ReactNode } from "react";
import { House, LibraryBig, BookOpen, ChartNoAxesCombined, Ellipsis, PanelLeftClose, PanelLeftOpen, type LucideIcon } from "lucide-react";
import { learningNavigation, navigationGroup, type NavigationGroup } from "@/lib/ui/navigation";

const icons: Readonly<Record<NavigationGroup, LucideIcon>> = { today: House, materials: LibraryBig, study: BookOpen, records: ChartNoAxesCombined, more: Ellipsis };

/** 단일 본문과 탐색 DOM을 CSS로 재배치하여 회전 때 입력 소유자가 재마운트되지 않게 합니다. */
export function ShellFrame({ pathname, children }: Readonly<{ pathname: string; children: ReactNode }>): ReactElement {
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const current: NavigationGroup = navigationGroup(pathname);
  return <div data-alter-ui className="alter-shell" data-collapsed={collapsed}>
    <a href="#learn-main" className="alter-skip alter-link">본문으로 바로가기</a>
    <aside className="alter-sidebar" aria-label="앱 탐색">
      <div className="alter-brand-row"><a href="/learn" className="alter-brand alter-link" aria-label="ALTER 오늘">ALTER<span aria-hidden="true">.</span></a><button type="button" className="alter-control alter-sidebar-toggle" aria-label={collapsed ? "탐색 펼치기" : "탐색 접기"} aria-expanded={!collapsed} aria-controls="alter-navigation" onClick={(): void => setCollapsed((value): boolean => !value)}>{collapsed ? <PanelLeftOpen className="alter-icon" aria-hidden="true" /> : <PanelLeftClose className="alter-icon" aria-hidden="true" />}</button></div>
      <nav id="alter-navigation" className="alter-navigation" aria-label="주 탐색">{learningNavigation.map((item): ReactElement => {
        const Icon: LucideIcon = icons[item.id];
        return <a key={item.id} href={item.href} className="alter-nav-item alter-link" aria-current={current === item.id ? "page" : undefined}><Icon className="alter-icon" aria-hidden="true" focusable="false" /><span className="alter-nav-label">{item.label}</span></a>;
      })}</nav>
    </aside>
    <div className="alter-workspace">{children}</div>
  </div>;
}
