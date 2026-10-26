import { librarianEvaluation } from "../../lib/librarian/contracts";
import type { LibrarianEvaluation, ScopeState } from "../../lib/librarian/contracts";

/** 상태·저장 검증용 모의 응답이며 실제 AI 호출 근거로 기록하지 않습니다. */
export function librarianOutputFixture(state: ScopeState): LibrarianEvaluation {
  return librarianEvaluation.parse({ kind: "librarian-evaluation", objective: state.unit.objective, uncertainty: ["실제 수행 수준은 미확인이에요."], candidates: state.candidates.map((candidate) => {
    const source = candidate.sources[0];
    if (!candidate.valid || !source) return { linkId: candidate.link.id,reliability: { judgment: "unverified",reason: "본문 미확인",citations: [] },difficulty: { judgment: "unverified",reason: "본문 미확인",citations: [] },relevance: { judgment: "unverified",reason: "본문 미확인",citations: [] },coverage: [],coverageEvidence: [],question: null,exercise: null };
    const cite = { sourceRefId: source.id, quote: source.evidence };
    const axis = { judgment: "supported",reason: "제공된 시험 원문에 근거한 잠정 적합성",citations: [cite] };
    return { linkId: candidate.link.id,reliability: axis,difficulty: axis,relevance: axis,coverage: ["explanation","example","practice"],coverageEvidence: ["explanation","example","practice"].map((role) => ({ role,...cite })),question: { text: "분수는 무엇인가요?",sourceRefIds: [source.id] },exercise: { text: "여덟 조각 중 세 조각을 분수로 쓰세요.",sourceRefIds: [source.id] } };
  }) });
}
