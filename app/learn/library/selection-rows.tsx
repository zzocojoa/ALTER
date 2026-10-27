import type { ReactElement } from "react";
import { MaterialEvidence } from "./material-evidence";
import type { CandidateSnapshot, SourceExcerpt } from "@/lib/librarian/contracts";

export function changeSelection(ids: readonly string[], id: string, checked: boolean): readonly string[] {
  return checked ? ids.includes(id) ? ids : [...ids, id] : ids.filter((selected): boolean => selected !== id);
}

type SelectionProps = Readonly<{ selected: readonly string[]; busy: boolean; onSelect: (id: string, checked: boolean) => void }>;

/** 원문 링크는 체크 라벨과 분리해 새 탭 대조가 선택을 바꾸지 않게 합니다. */
export function SourceChoices({ sources, selected, busy, covered, onSelect }: SelectionProps & Readonly<{ sources: readonly SourceExcerpt[]; covered: boolean }>): ReactElement {
  return <fieldset className="library-selection"><legend>이번에 연결할 확인 구간 (최대 8개)</legend><p role="status">확인 구간 {selected.length}개 선택 / 최대 8개</p><ul>{sources.map((source): ReactElement => <li key={source.id} className="library-selection-row" data-selected={selected.includes(source.id)}><label><input type="checkbox" name="sources" value={source.id} checked={selected.includes(source.id)} disabled={busy || selected.length >= 8 && !selected.includes(source.id)} onChange={(event): void => onSelect(source.id, event.target.checked)} /><span><strong>파일 {source.filePage}쪽 · 인쇄 쪽수 {source.printedPage ?? "미확인"}</strong><span className="library-row-meta">{covered ? "원문 가림" : source.evidence.slice(0,100)}</span></span></label><a href={`/learn/source/${source.id}`} target="_blank" rel="noreferrer">원본 구간 확인</a></li>)}</ul>{sources.length === 0 && <p>확인된 출처가 없어요. <a href="/learn/materials">자료 보관함에서 본문을 확인</a>한 뒤 다시 선택해 주세요. 미확인 연결로 저장할 수도 있어요.</p>}{selected.length === 8 && <p>8개까지 연결할 수 있어요. 다른 구간을 고르려면 기존 선택을 해제해 주세요.</p>}</fieldset>;
}

export function CandidateChoices({ candidates, selected, busy, onSelect }: SelectionProps & Readonly<{ candidates: readonly CandidateSnapshot[] }>): ReactElement {
  const verified: number = candidates.filter((candidate): boolean => selected.includes(candidate.link.id) && candidate.valid).length;
  return <fieldset className="library-selection"><legend>비교할 자료 선택 (최대 12개)</legend><p role="status">자료 {selected.length}개 선택 · 본문 확인 {verified}개 / 최대 12개</p><ul>{candidates.map((candidate): ReactElement => <li key={candidate.link.id} className="library-selection-row" data-selected={selected.includes(candidate.link.id)}><label><input type="checkbox" name="links" value={candidate.link.id} checked={selected.includes(candidate.link.id)} disabled={busy || selected.length >= 12 && !selected.includes(candidate.link.id)} onChange={(event): void => onSelect(candidate.link.id, event.target.checked)} /><span><strong>{candidate.link.metadata.title}</strong><span className="library-row-meta">{candidate.link.toc} · {candidate.link.metadata.edition || "판본 미입력"} · 읽기 {candidate.link.readingMinutes}분</span><span className={candidate.valid ? "library-row-confirmed" : "library-row-unverified"}>{candidate.valid ? "본문 확인됨" : "본문 재확인 필요"}</span></span></label><details><summary>서지·본문 확인 상태</summary><MaterialEvidence candidate={candidate} /></details></li>)}</ul>{candidates.length === 0 && <p>이 단원에 연결한 구간이 없어요. 위에서 자료의 확인 구간을 먼저 연결해 주세요.</p>}{selected.length === 12 && <p>12개까지 비교할 수 있어요. 다른 자료를 고르려면 기존 선택을 해제해 주세요.</p>}</fieldset>;
}
