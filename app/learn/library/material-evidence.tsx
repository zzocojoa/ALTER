import type { ReactElement } from "react";
import type { CandidateSnapshot, ConfirmedUnit, PrerequisiteState } from "@/lib/librarian/contracts";

export function MaterialEvidence({ candidate }: Readonly<{ candidate: CandidateSnapshot }>): ReactElement {
  const { metadata, bibliography } = candidate.link;
  const external = bibliography.external;
  return <section className="library-material-evidence" aria-label={`${metadata.title} 출처 확인`}><dl><div><dt>본문 구간</dt><dd>{candidate.valid ? "원본 대조 확인됨" : "본문 재확인 필요"}</dd></div><div><dt>서지 근거</dt><dd>{bibliography.checked ? "확인됨" : "미확인"}</dd></div><div><dt>저자</dt><dd>{bibliography.author || "미입력"}</dd></div><div><dt>출처</dt><dd>{bibliography.origin || "미입력"}</dd></div><div><dt>등록한 판본</dt><dd>{metadata.edition || "미입력"}</dd></div></dl>{!candidate.valid && <p className="library-warning">{candidate.reason ?? "최신 본문을 대조하고 구간을 다시 연결해 주세요."}</p>}{external ? <div className="library-external-evidence"><h4>외부 서지 · {external.kind === "publisher" ? "출판사 확인" : "사용자 확인"}</h4><p>{external.title} · 확인한 판본 {external.edition ?? "미확인"}</p><blockquote>{external.evidence}</blockquote>{external.url && <a href={external.url} target="_blank" rel="noreferrer">서지 확인 주소</a>}<p>이 근거는 교재 정보 확인용이에요. 본문·문제·정답을 확인한 근거와 구별해요.</p></div> : <p>PDF 본문에서 확인한 서지: {bibliography.evidenceSourceId ? <a href={`/learn/source/${bibliography.evidenceSourceId}`} target="_blank" rel="noreferrer">서지 근거 원문 보기</a> : "근거 구간 미확인"}</p>}</section>;
}

const statusLabels: Readonly<Record<PrerequisiteState["status"], string>> = { met: "수행 근거 충족", unmet: "수행 근거 미충족", unverified: "수행 근거 미확인" };
export function UnitRequirements({ unit, units, states }: Readonly<{ unit: ConfirmedUnit; units: readonly ConfirmedUnit[]; states: readonly PrerequisiteState[] }>): ReactElement {
  const current = states.find((state): boolean => state.unitId === unit.unitId);
  return <section className="library-prerequisites" aria-label="단원 진행과 선행 조건"><h3>단원 진행과 선행 조건</h3><p>진도 {current?.progress ?? "미확인"} · 수행 {current ? statusLabels[current.status] : "근거 미확인"} · 지연 재현 {current?.delayedRecall ?? "미확인"}</p>{unit.prerequisiteUnitIds.length === 0 ? <p>지정한 선행 단원이 없어요.</p> : <ul>{unit.prerequisiteUnitIds.map((id): ReactElement => { const prerequisite = states.find((state): boolean => state.unitId === id); return <li key={id}><strong>{units.find((known): boolean => known.unitId === id)?.title ?? "현재 계획에서 이름 미확인"}</strong> · {prerequisite ? statusLabels[prerequisite.status] : "수행 근거 미확인"}</li>; })}</ul>}<p>진도 완료만으로 선행 조건이나 지연 재현을 충족했다고 판단하지 않아요.</p></section>;
}
