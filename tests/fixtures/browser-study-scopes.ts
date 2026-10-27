type BrowserStudyScopes = Readonly<{ project: string; reviewId: string; historyId: string }>;

/** 복습 확정이 다른 검사의 범위 근거를 바꾸지 않도록 계획과 범위를 분리합니다. */
export const browserStudyScopes: readonly BrowserStudyScopes[] = [
  { project: "desktop-chromium", reviewId: "00000000-0000-4000-a000-000000019101", historyId: "00000000-0000-4000-a000-000000019102" },
  { project: "mobile-chromium", reviewId: "00000000-0000-4000-a000-000000019103", historyId: "00000000-0000-4000-a000-000000019104" },
];

export function studyScopesForProject(project: string): BrowserStudyScopes {
  const scopes: BrowserStudyScopes | undefined = browserStudyScopes.find((value): boolean => value.project === project);
  if (!scopes) throw new Error(`브라우저 검사 전용 범위가 없는 프로젝트입니다: ${project}`);
  return scopes;
}
