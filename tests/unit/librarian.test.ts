import { recordId } from "../../lib/domain/contracts";
import { requireBibliographyEvidence } from "../../lib/librarian/bibliography";
import { requireLibrarianAcceptance } from "../../lib/librarian/acceptance";
import { initialStudyScope } from "../../lib/librarian/state";
import { ADVISOR_ACCEPTANCE_ID } from "../../lib/advisor/acceptance";
import { LIBRARIAN_HELP_ACCEPTANCE_ID,LIBRARIAN_HELP_LINK_ID,LIBRARIAN_HELP_UNIT_TITLE,STUDY_ACCEPTANCE_TEXT,STUDY_ACCEPTANCE_TITLE } from "../../lib/librarian/acceptance-fixture";
import { describe, expect, it } from "vitest";
import { ASSESSMENT_CONTRACT } from "../../lib/advisor/contracts";
import { candidateSnapshot, confirmedUnit, librarianEvaluation } from "../../lib/librarian/contracts";
import type { CandidateSnapshot, ConfirmedUnit, LibrarianEvaluation } from "../../lib/librarian/contracts";
import { knownSourceAccessIssue, materialIssues, sourceRecheckAction } from "../../lib/librarian/issues";
import { materialFailure } from "../../lib/materials/policy";
import { proposeStudyRange, orderUnitOptions } from "../../lib/librarian/range";
import { scopeInput, prerequisiteState } from "../../lib/librarian/contracts";
import { minimumMaterialSet } from "../../lib/librarian/selection";
import { validateLibrarianEvaluation } from "../../lib/librarian/evaluation";

const id = (n: number): string => `00000000-0000-4000-a000-${String(n).padStart(12,"0")}`;
export function unitFixture(): ConfirmedUnit { return confirmedUnit.parse({ planId: id(1),planVersionId: id(2),planOrdinal: 1,courseId: id(1),unitId: id(3),unitVersion: 1,title: "분수",objective: "분수의 의미를 설명한다",selfExplanationCriterion: "자료 없는 설명",newConditionCriterion: "새 조각 문제 독립 풀이",prerequisiteUnitIds: [],assessment: ASSESSMENT_CONTRACT,selfReportedLevel: "초보라고 자기 보고" }); }
export function candidateFixture(n: number): CandidateSnapshot {
  const evidence: string = "ALTER 자체 시험 자료 v1. 분수는 전체를 같은 크기로 나눈 부분. 예시: 1/4. 연습: 여덟 조각 중 셋을 분수로 써라.";
  return candidateSnapshot.parse({ link: { id: id(n),planVersionId: id(2),unitId: id(3),materialId: id(n+20),toc: "분수",sourceRefIds: [id(n+40)],bibliography: { author: "ALTER",origin: "자체 시험 자료",checked: true,evidenceSourceId: id(n+40) },readingMinutes: 5,metadata: { title: "시험 자료",edition: "v1",role: "textbook",kind: "text",filename: "test.txt",mime: "text/plain",bytes: 500,sha256: "a".repeat(64) },version: 1,createdAt: 1 },valid: true,reason: null,sources: [{ id: id(n+40),materialId: id(n+20),uploadId: id(n+60),pageId: id(n+80),filePage: 1,printedPage: null,spanStart: 0,spanEnd: Array.from(evidence).length,evidence }],fingerprint: "b".repeat(64) });
}
export function evaluationFixture(candidates: readonly CandidateSnapshot[]): LibrarianEvaluation {
  return librarianEvaluation.parse({ kind: "librarian-evaluation",objective: unitFixture().objective,uncertainty: ["실제 수행 수준은 미확인"],candidates: candidates.map((candidate) => {
    const citation = { sourceRefId: candidate.sources[0].id,quote: "분수는 전체를 같은 크기로 나눈 부분" };
    const axis = { judgment: "supported",reason: "제공된 원문에 근거한 초기 적합성 판단",citations: [citation] };
    return { linkId: candidate.link.id,reliability: axis,difficulty: axis,relevance: axis,coverage: ["explanation","example","practice"],coverageEvidence: ["explanation","example","practice"].map((role) => ({ role,...citation })),question: { text: "분자와 분모는 무엇인가요?",sourceRefIds: [citation.sourceRefId] },exercise: { text: "여덟 조각 중 세 조각을 분수로 쓰세요.",sourceRefIds: [citation.sourceRefId] } };
  }) });
}
describe("Librarian 근거 평가", () => {
  it("정확한 구간 인용과 목표만 수용한다", () => { const candidates = [candidateFixture(10)]; const output = evaluationFixture(candidates); expect(() => validateLibrarianEvaluation(output,unitFixture(),candidates)).not.toThrow(); expect(() => validateLibrarianEvaluation({ ...output,objective: "범위 확장" },unitFixture(),candidates)).toThrow(); });
  it("없는 후보·없는 인용·서지 미확인 승격을 거부한다", () => {
    const candidates = [candidateFixture(10)]; const output = evaluationFixture(candidates); const item=output.candidates[0];
    expect(() => validateLibrarianEvaluation({ ...output,candidates: [{ ...item,relevance: { ...item.relevance,citations: [{ sourceRefId: candidates[0].sources[0].id,quote: "없는 내용" }] } }] },unitFixture(),candidates)).toThrow();
    expect(() => validateLibrarianEvaluation(output,unitFixture(),[{ ...candidates[0],link: { ...candidates[0].link,bibliography: { author: "",origin: "",checked: false,evidenceSourceId: null } } }])).toThrow();
    expect(() => validateLibrarianEvaluation(output,unitFixture(),[{ ...candidates[0],valid: false,reason: "unconfirmed" }])).toThrow();
  });
  it("미확인 후보는 평가를 꾸미지 않고 빈 근거로 남긴다", () => {
    const candidate = { ...candidateFixture(10),valid: false,sources: [],reason: "원문 미확인" }; const axis = { judgment: "unverified" as const,reason: "본문 확인 필요",citations: [] };
    const output = librarianEvaluation.parse({ kind: "librarian-evaluation",objective: unitFixture().objective,uncertainty: ["자료 부족"],candidates: [{ linkId: candidate.link.id,reliability: axis,difficulty: axis,relevance: axis,coverage: [],coverageEvidence: [],question: null,exercise: null }] });
    expect(() => validateLibrarianEvaluation(output,unitFixture(),[candidate])).not.toThrow();
  });
  it("핵심 질문·직접 과제 누락과 구간 밖 참조를 거부한다", () => {
    const candidate = candidateFixture(10); const output=evaluationFixture([candidate]); const item=output.candidates[0];
    expect(() => validateLibrarianEvaluation({ ...output,candidates: [{ ...item,exercise: null }] },unitFixture(),[candidate])).toThrow();
    expect(() => validateLibrarianEvaluation({ ...output,candidates: [{ ...item,coverageEvidence: [] }] },unitFixture(),[candidate])).toThrow();
  });
});

describe("최소 자료 집합", () => {
  it("동일 목표의 중복 후보 중 최소 수·짧은 읽기 시간을 선택한다", () => {
    const first = candidateFixture(10); const second = { ...candidateFixture(11),link: { ...candidateFixture(11).link,readingMinutes: 3 } };
    const output = minimumMaterialSet(unitFixture(),[first,second],evaluationFixture([first,second]));
    expect(output.selectedIds).toEqual([second.link.id]); expect(output.decisions[0].alternativeIds).toEqual([second.link.id]);
  });
  it("설명·예제와 직접 수행이 보완되는 두 자료는 모두 보존한다", () => {
    const candidates=[candidateFixture(10),candidateFixture(11)]; const evaluation=evaluationFixture(candidates);
    const separated={ ...evaluation,candidates: evaluation.candidates.map((item,index) => ({ ...item,coverage: item.coverage.filter((role) => index === 0 ? role !== "practice" : role === "practice"),coverageEvidence: item.coverageEvidence.filter((entry) => index === 0 ? entry.role !== "practice" : entry.role === "practice") })) };
    expect(minimumMaterialSet(unitFixture(),candidates,separated).selectedIds).toHaveLength(2);
    expect(minimumMaterialSet(unitFixture(),[candidates[0]],{ ...separated,candidates: [separated.candidates[0]] }).missingRoles).toEqual(["practice"]);
  });
  it("근거 부족 후보는 자료 수가 적어도 채택하지 않는다", () => {
    const candidates=[candidateFixture(10)]; const evaluation=evaluationFixture(candidates);
    const result=minimumMaterialSet(unitFixture(),candidates,{ ...evaluation,candidates: evaluation.candidates.map((item) => ({ ...item,difficulty: { judgment: "unverified",reason: "수준 근거 없음",citations: [] } })) });
    expect(result.status).toBe("needs-material"); expect(result.selectedIds).toEqual([]);
  });
});

describe("시간·선수·진도 범위", () => {
  const input = () => scopeInput.parse({ id: id(90),planVersionId: id(2),unitId: id(3),date: "2026-10-24",availableMinutes: 15,questionMinutes: 5,practiceMinutes: 5,linkIds: [id(10)] });
  const progress = () => ({ current: prerequisiteState.parse({ unitId: id(3),status: "unverified",evidenceId: null,progress: "미시작",delayedRecall: "미확인" }),completedSourceIds: [] });
  it("읽기·질문·수행을 포함한 경계값과 부족 시간을 판정한다", () => {
    const candidates=[candidateFixture(10)]; const evaluation=evaluationFixture(candidates);
    const run = (minutes: number) => proposeStudyRange({ ...input(),availableMinutes: minutes },unitFixture(),candidates,evaluation,[],progress());
    expect(run(15).minutes).toBe(15); expect(run(14).status).toBe("needs-time"); expect(run(1).requiredMinutes).toBe(15);
    expect(() => run(0)).toThrow(); expect(() => run(-1)).toThrow();
    expect(candidates[0].sources[0].evidence).toContain("여덟 조각");
  });
  it("선수 미확인·미충족을 막고 지연 재현 미확인은 독립 수행 이후 병행을 막지 않는다", () => {
    const candidates=[candidateFixture(10)]; const evaluation=evaluationFixture(candidates); const unit={ ...unitFixture(),prerequisiteUnitIds: [unitFixture().courseId] };
    const state={ ...progress().current,unitId: unit.courseId };
    expect(proposeStudyRange(input(),unit,candidates,evaluation,[state],progress()).status).toBe("needs-prerequisite");
    expect(proposeStudyRange(input(),unit,candidates,evaluation,[{ ...state,status: "unmet" }],progress()).status).toBe("needs-prerequisite");
    expect(proposeStudyRange(input(),unit,candidates,evaluation,[{ ...state,status: "met",progress: "완료",evidenceId: unit.planId }],progress()).status).toBe("ready");
  });
  it("완료 구간을 자르지 않고 사용자 재선택을 요청한다", () => {
    const candidate=candidateFixture(10); const result=proposeStudyRange(input(),unitFixture(),[candidate],evaluationFixture([candidate]),[],{ ...progress(),completedSourceIds: [candidate.sources[0].id] });
    expect(result.status).toBe("needs-range"); expect(result.selectedIds).toEqual([]);
  });
  it("진행 중인 단원을 먼저 배치하며 완료 단원을 신규 학습에서 제외한다", () => {
    const first=unitFixture(); const second={ ...first,unitId: first.courseId }; const states=[progress().current,{ ...progress().current,unitId: second.unitId,progress: "진행 중" as const }];
    expect(orderUnitOptions([first,second],states)[0].unit.unitId).toBe(second.unitId);
    expect(orderUnitOptions([first],[{ ...states[0],progress: "완료" }])[0].available).toBe(false);
  });
});

describe("자료 부족과 확인 요청", () => {
  it("전체 누락·본문 미확인·서지 미확인을 구분한다", () => {
    expect(materialIssues([])[0].action).toContain("연결된 자료가 없어요");
    const candidate={ ...candidateFixture(10),valid: false,sources: [],reason: "본문 대조 필요" };
    expect(materialIssues([candidate])[0].action).toBe("본문 대조 필요");
    expect(materialIssues([{ ...candidateFixture(10),link: { ...candidateFixture(10).link,bibliography: { author: "",origin: "",checked: false,evidenceSourceId: null } } }])[0].action).toContain("서지 근거");
  });
  it("판독 불가와 원본 접근 실패는 명시하고 권한 거부와 서버 오류를 우회하지 않는다", () => {
    expect(sourceRecheckAction("unreadable")).toContain("읽을 수 없는");
    expect(knownSourceAccessIssue(materialFailure("material_storage_unavailable","object-missing",409))).toContain("원본이 없거나");
    expect(knownSourceAccessIssue(materialFailure("material_access_required","material-hidden-during-recall",403))).toBeNull();
    expect(knownSourceAccessIssue(new Error("storage timeout"))).toBeNull();
  });
});

describe("현재 진도를 보존하는 고정 도움 검증 범위",()=>{
  it("승인한 다음 단원과 고정 자료만 허용하며 완료한 범위를 다시 열지 않는다",()=>{
    const unit=confirmedUnit.parse({...unitFixture(),planId:ADVISOR_ACCEPTANCE_ID,title:LIBRARIAN_HELP_UNIT_TITLE,prerequisiteUnitIds:[id(91)]});
    const original=candidateFixture(4);
    const candidate=candidateSnapshot.parse({...original,link:{...original.link,id:LIBRARIAN_HELP_LINK_ID,toc:"분수의 뜻과 같은 분모 덧셈",metadata:{...original.link.metadata,title:STUDY_ACCEPTANCE_TITLE,edition:"시험 1판"},bibliography:{...original.link.bibliography,origin:"자체 작성 시험 자료"}},sources:[{...original.sources[0],evidence:STUDY_ACCEPTANCE_TEXT,spanEnd:Array.from(STUDY_ACCEPTANCE_TEXT).length}]});
    const input=scopeInput.parse({id:LIBRARIAN_HELP_ACCEPTANCE_ID,planVersionId:unit.planVersionId,unitId:unit.unitId,date:"2026-10-26",availableMinutes:30,questionMinutes:5,practiceMinutes:10,linkIds:[candidate.link.id]});
    const prerequisite=prerequisiteState.parse({unitId:id(91),status:"met",evidenceId:id(92),progress:"완료",delayedRecall:"미확인"});
    const current=prerequisiteState.parse({unitId:unit.unitId,status:"unverified",evidenceId:null,progress:"미시작",delayedRecall:"미확인"});
    const state=initialStudyScope(input,unit,[candidate],[prerequisite],{current,completedSourceIds:[]});
    expect(()=>requireLibrarianAcceptance(state)).not.toThrow();
    expect(()=>requireLibrarianAcceptance({...state,unit:{...unit,title:"개인 학습 단원"}})).toThrow();
    expect(()=>requireLibrarianAcceptance({...state,candidates:[{...candidate,sources:[{...candidate.sources[0],evidence:"개인 교재"}]}]})).toThrow();
    const evaluation={...evaluationFixture([candidate]),objective:unit.objective,candidates:evaluationFixture([candidate]).candidates.map(item=>({...item,reliability:{...item.reliability,citations:[{sourceRefId:candidate.sources[0].id,quote:"분수는 전체를 같은 크기로 나눈 부분"}]}}))};
    expect(proposeStudyRange(input,unit,[candidate],evaluation,[prerequisite],{current:{...current,progress:"완료"},completedSourceIds:[]}).status).toBe("needs-range");
  });
});

describe("외부 서지와 본문 근거의 분리", () => {
  const original = candidateFixture(10);
  const external = { id: recordId.parse(id(900)), kind: "user-statement" as const, title: "이기적 바리스타 2급 필기 기본서", edition: null, url: "https://shop.youngjin.com/goods/view_contents?no=1097&zoom=1", evidence: "사용자 확인: 이기적 바리스타 2급 필기 기본서. 저자 임형준, 출판사 영진닷컴. 판본 미확인." };
  const candidate = candidateSnapshot.parse({ ...original, link: { ...original.link, bibliography: { author: "임형준", origin: "영진닷컴", checked: true, evidenceSourceId: null, external } } });
  const output = evaluationFixture([candidate]);
  const item = { ...output.candidates[0], reliability: { judgment: "supported" as const, reason: "사용자 제공 서지 확인; 판본 미확인", citations: [{ sourceRefId: external.id, quote: external.evidence }] } };
  it("판본 미상의 사용자 확인을 본문 위조 없이 저장하고 평가한다", () => {
    expect(() => requireBibliographyEvidence(candidate.link,candidate.sources)).not.toThrow();
    expect(() => validateLibrarianEvaluation({ ...output,candidates: [item] },unitFixture(),[candidate])).not.toThrow();
    expect(candidate.link.bibliography.external?.edition).toBeNull();
  });
  it("외부 서지를 난도·본문·수행 과제의 인용으로 사용하지 못한다", () => {
    for (const changed of [{ ...item, difficulty: item.reliability }, { ...item, coverageEvidence: [{ role: "explanation" as const, sourceRefId: external.id, quote: external.evidence }], coverage: ["explanation" as const] }, { ...item, exercise: { text: "임의 과제", sourceRefIds: [external.id] } }]) {
      expect(() => validateLibrarianEvaluation({ ...output,candidates: [changed] },unitFixture(),[candidate])).toThrow();
    }
  });
  it("외부 근거의 없는 인용·저자 변경·출판사 URL 누락·본문 ID 중복을 거부한다", () => {
    expect(() => validateLibrarianEvaluation({ ...output,candidates: [{ ...item, reliability: { ...item.reliability, citations: [{ sourceRefId: external.id, quote: "확인하지 않은 판본" }] } }] },unitFixture(),[candidate])).toThrow();
    for (const bibliography of [{ ...candidate.link.bibliography, author: "다른 저자" }, { ...candidate.link.bibliography, external: { ...external,kind: "publisher" as const,url: null } }, { ...candidate.link.bibliography, external: { ...external,id: candidate.sources[0].id } }, { ...candidate.link.bibliography, checked: false }, { ...candidate.link.bibliography, evidenceSourceId: candidate.sources[0].id }]) {
      expect(() => requireBibliographyEvidence({ ...candidate.link,bibliography },candidate.sources)).toThrow();
    }
  });
});

it("같은 역할의 서로 다른 원문 근거를 보존하고 중복 인용과 근거 없는 역할은 거부한다", () => {
  const candidate = candidateFixture(10); const output = evaluationFixture([candidate]); const item = output.candidates[0];
  const extra = { role: "explanation" as const,sourceRefId:candidate.sources[0].id,quote:"예시: 1/4" };
  const withMultiple = { ...item,coverageEvidence:[...item.coverageEvidence,extra] };
  expect(() => validateLibrarianEvaluation({ ...output,candidates:[withMultiple] },unitFixture(),[candidate])).not.toThrow();
  expect(() => validateLibrarianEvaluation({ ...output,candidates:[{ ...withMultiple,coverageEvidence:[...withMultiple.coverageEvidence,extra] }] },unitFixture(),[candidate])).toThrow();
  expect(() => validateLibrarianEvaluation({ ...output,candidates:[{ ...item,coverageEvidence:item.coverageEvidence.filter(entry=>entry.role!=="practice") }] },unitFixture(),[candidate])).toThrow();
});
it("새 범위의 명시적 합성 수준을 저장해도 확정 계획의 자기 보고를 바꾸지 않는다", () => {
  const unit = unitFixture();
  const input = scopeInput.parse({ id:id(95),planVersionId:unit.planVersionId,unitId:unit.unitId,date:"2026-10-26",availableMinutes:30,questionMinutes:5,practiceMinutes:10,linkIds:[id(10)],levelStatement:"합성 초급 검증; 실제 사용자 수준 미확인" });
  const progress = {current:prerequisiteState.parse({unitId:unit.unitId,status:"unverified",evidenceId:null,progress:"미시작",delayedRecall:"미확인"}),completedSourceIds:[]};
  const state = initialStudyScope(input,unit,[candidateFixture(10)],[],progress);
  expect(state.input.levelStatement).toBe(input.levelStatement); expect(state.unit.selfReportedLevel).toBe(unit.selfReportedLevel);
});
