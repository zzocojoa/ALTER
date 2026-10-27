import type { ReactElement } from "react";
import type { CandidateSnapshot, ScopeState } from "@/lib/librarian/contracts";

export type ScopeTimeDraft = Readonly<{ available: string; questions: string; practice: string }>;
function minutes(value: string, maximum: number): number | null {
  const parsed: number = Number(value);
  return value.trim() !== "" && Number.isInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : null;
}
function duration(value: number | null): string { return value === null ? "입력 확인 필요" : `${value}분`; }
function readingTime(candidates: readonly CandidateSnapshot[]): number {
  return candidates.reduce((total: number, candidate): number => total + candidate.link.readingMinutes, 0);
}
function ScopeSources({ candidates }: Readonly<{ candidates: readonly CandidateSnapshot[] }>): ReactElement {
  return <ul className="library-time-sources">{candidates.map((candidate): ReactElement => <li key={candidate.link.id}><strong>{candidate.link.metadata.title}</strong> · {candidate.link.toc} · 읽기 {candidate.link.readingMinutes}분<div>{candidate.sources.map((source): ReactElement => <a href={`/learn/source/${source.id}`} key={source.id} target="_blank" rel="noreferrer">파일 {source.filePage}쪽 · 인쇄 {source.printedPage ?? "미확인"}</a>)}</div>{!candidate.valid && <span className="library-row-unverified">본문 재확인 필요</span>}</li>)}</ul>;
}

/** 후보 전체 예상은 배정 결과와 다릅니다. 자동으로 구간이나 시간을 줄이지 않습니다. */
export function DraftScopeTiming({ candidates, selected, times }: Readonly<{ candidates: readonly CandidateSnapshot[]; selected: readonly string[]; times: ScopeTimeDraft }>): ReactElement {
  const chosen: readonly CandidateSnapshot[] = candidates.filter((candidate): boolean => selected.includes(candidate.link.id));
  const available: number | null = minutes(times.available, 240);
  const questions: number | null = minutes(times.questions, 120);
  const practice: number | null = minutes(times.practice, 120);
  const expected: number | null = chosen.length === 0 || questions === null || practice === null ? null : readingTime(chosen) + questions + practice;
  return <section className="library-time-summary" aria-label="작성 중 시간과 구간"><h3>시간과 구간 확인</h3><dl><div><dt>가용 시간</dt><dd>{duration(available)}</dd></div><div><dt>후보 전체 예상</dt><dd>{duration(expected)}</dd></div><div><dt>배정 시간</dt><dd>아직 미배정</dd></div></dl><p>후보 전체 예상은 읽기 {readingTime(chosen)}분 + 질문·인출 {duration(questions)} + 직접 수행 {duration(practice)}이에요. 자료 비교 후 선정된 구간의 배정 시간을 따로 확인해 주세요.</p>{available !== null && expected !== null && expected > available && <p className="library-warning" role="status">후보 전체 예상이 가용 시간보다 {expected - available}분 많아요. 시간을 늘리거나 작은 구간을 고를 수 있어요. 비교에서 일부 후보가 제외될 수 있으며, 제안된 배정 시간이 가용 시간을 넘으면 확정할 수 없어요.</p>}<ScopeSources candidates={chosen} /></section>;
}

export function SavedScopeTiming({ scope }: Readonly<{ scope: ScopeState }>): ReactElement {
  const expected: number = readingTime(scope.candidates) + scope.input.questionMinutes + scope.input.practiceMinutes;
  const allocated: number | null = scope.bundle?.plannedMinutes ?? null;
  return <section className="library-time-summary" aria-label="저장된 시간과 구간"><h3>저장된 시간과 구간</h3><dl><div><dt>가용 시간</dt><dd>{scope.input.availableMinutes}분</dd></div><div><dt>후보 전체 예상</dt><dd>{expected}분</dd></div><div><dt>배정 시간</dt><dd>{allocated === null ? "아직 미배정" : `${allocated}분`}</dd></div></dl><p>읽기 {readingTime(scope.candidates)}분 · 질문·인출 {scope.input.questionMinutes}분 · 직접 수행 {scope.input.practiceMinutes}분</p>{scope.phase === "proposed" && allocated !== null && <p>제안 단계의 배정 시간이에요. 원문과 선정 근거를 검토한 뒤 직접 확정해 주세요.</p>}{scope.selection?.status === "needs-time" && <p role="status" className="library-warning">최소 {scope.selection.requiredMinutes}분이 필요하지만 가용 시간은 {scope.input.availableMinutes}분이에요. 범위나 시간을 다시 선택해 주세요.</p>}<ScopeSources candidates={scope.candidates} /></section>;
}
