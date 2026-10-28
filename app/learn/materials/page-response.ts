import type { StoredExtractionPage } from "@/lib/extraction/state";

type ExpectedPage = Pick<StoredExtractionPage, "id" | "jobId" | "selectionRevision" | "filePage" | "version" | "resultVersion">;

export function requirePageResponse(saved: StoredExtractionPage, expected: ExpectedPage): void {
  if (saved.id !== expected.id || saved.jobId !== expected.jobId || saved.selectionRevision !== expected.selectionRevision || saved.filePage !== expected.filePage || saved.version < expected.version || saved.resultVersion < expected.resultVersion) throw Object.assign(new Error("저장 응답의 파일 페이지·선택 범위·기록 판이 달라요. 현재 저장 결과를 다시 읽어 주세요."), { name: "ExtractionSaveConflict" });
}

/** 조회 중 저장된 새 판을 늦은 조회 응답으로 되돌리지 않습니다. */
export function mergePageSnapshot(current: readonly StoredExtractionPage[], received: readonly StoredExtractionPage[]): readonly StoredExtractionPage[] {
  return received.map((page): StoredExtractionPage => {
    const latest: StoredExtractionPage | undefined = current.find((entry): boolean => entry.id === page.id && entry.jobId === page.jobId && entry.selectionRevision === page.selectionRevision && entry.filePage === page.filePage);
    if (latest === undefined) return page;
    if (page.version === latest.version && page.resultId !== latest.resultId) throw new Error("같은 기록 판에 다른 추출 결과가 있어요. 저장 상태를 다시 확인해 주세요.");
    return latest.version > page.version ? latest : page;
  });
}
