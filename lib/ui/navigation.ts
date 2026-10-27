export type NavigationGroup = "today" | "materials" | "study" | "records" | "more";
export type NavigationEntry = Readonly<{ id: NavigationGroup; label: string; href: string }>;
export const learningNavigation: readonly NavigationEntry[] = [
  { id: "today", label: "오늘", href: "/learn" },
  { id: "materials", label: "자료", href: "/learn/materials" },
  { id: "study", label: "학습", href: "/learn/tutor" },
  { id: "records", label: "기록", href: "/learn/results" },
  { id: "more", label: "더보기", href: "/learn/more" },
];
const groups: Readonly<Record<string, NavigationGroup>> = {
  "/learn": "today", "/learn/materials": "materials", "/learn/advisor": "study", "/learn/library": "study", "/learn/tutor": "study", "/learn/editor": "study", "/learn/calendar": "study", "/learn/results": "records", "/learn/weekly": "records", "/learn/weekly/version": "records", "/learn/google": "more", "/learn/google/references": "more", "/learn/backup": "more", "/learn/more": "more", "/learn/diagnostics": "more",
};

/** 서버 라우트의 현재 위치만 분류하며 쿼리·해시·인증 복귀 규칙은 바꾸지 않습니다. */
export function navigationGroup(pathname: string): NavigationGroup {
  if (/^\/learn\/source\/[^/]+$/.test(pathname)) return "materials";
  const group: NavigationGroup | undefined = groups[pathname];
  if (group === undefined) throw new RangeError("학습 탐색에 등록되지 않은 경로입니다: " + pathname);
  return group;
}
