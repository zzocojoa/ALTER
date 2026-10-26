import { startAdvisor, beginStoredAdvisorAi, getAdvisor, saveAdvisorTurn, submitAdvisorAnswer, saveAdvisorPlan, confirmAdvisorPlan } from "../../db/repositories/advisor";
import { getMaterialTransfer } from "../../db/repositories/material-transfers";
import { saveExtractionSelection } from "../../db/repositories/extraction-jobs";
import { listExtractionPages, getExtractionPage, saveTextExtraction } from "../../db/repositories/extraction-pages";
import { confirmExtractionSegments } from "../../db/repositories/extraction-confirmations";
import { createExtractionSource } from "../../db/repositories/extraction-sources";
import { createMaterialLink, listConfirmedUnits } from "../../db/repositories/librarian-links";
import { createStudyScope, getStudyScope, beginStoredScopeEvaluation, saveScopeEvaluation, confirmStoredScope, readTutorBundle } from "../../db/repositories/study-scopes";
import { learningConditions } from "../../lib/advisor/conditions";
import { recordId, seoulStudyDate } from "../../lib/domain/contracts";
import type { Command, SiteIdentity } from "../../lib/domain/contracts";
import { verifyMaterialInventory } from "../../lib/materials/inventory";
import { startMaterialTransfer } from "../../lib/materials/start";
import { uploadMaterialBody } from "../../lib/materials/upload";
import { completeMaterialTransfer } from "../../lib/materials/complete";
import { materialFileReference } from "../../lib/materials/attachment";
import { readMaterialObject } from "../../lib/materials/object";
import { buildSelection } from "../../lib/extraction/selection";
import { requireExtractionPage, requireExtractionText } from "../../lib/extraction/server";
import { linkInput, scopeInput } from "../../lib/librarian/contracts";
import pdf from "../../lib/materials/pdf-wasm/validator.wasm";
import jpeg from "../../lib/materials/jpeg-wasm/decoder.wasm";
import { librarianOutputFixture } from "./librarian-output";
import { learningFlowSource } from "./learning-flow-cases";
import type { LearningFlowCase } from "./learning-flow-cases";

export type LearningFlowEnvironment = Readonly<{ DB: D1Database; BUCKET: R2Bucket }>;
export type LinkedLearningFlow = Readonly<{ owner: SiteIdentity; courseId: string; materialId: string; sourceId: string; linkId: string }>;
export type PreparedLearningFlow = Readonly<LinkedLearningFlow & { scopeId: string }>;
export function flowCommand(owner: SiteIdentity, expectedVersion: number): Command {
  return { owner, expectedVersion, requestKey: crypto.randomUUID() };
}
export function requireFlow(value: boolean, rule: string): void {
  if (!value) throw new Error(`학습 통합 검증 실패: ${rule}`);
}

async function prepareAdvisor(db: D1Database, owner: SiteIdentity, scenario: LearningFlowCase): Promise<string> {
  const id: string = crypto.randomUUID();
  await startAdvisor(db, flowCommand(owner, 1), id, learningConditions.parse({ title: scenario.title, domain: scenario.domain, purpose: scenario.question, selfReportedLevel: "초보라는 자기 보고", minutesPerWeek: 120, startDate: "2026-10-24", endDate: "2026-11-20", excludedScope: ["고급 응용"] }));
  for (let index: number = 0; index < 3; index += 1) {
    let state = await getAdvisor(db, owner, id);
    await beginStoredAdvisorAi(db, flowCommand(owner, state.version), id);
    state = await getAdvisor(db, owner, id);
    const answer = state.answers.at(-1);
    await saveAdvisorTurn(db, owner, state, { kind: "advisor-turn", evaluation: answer ? { answerId: answer.id, quote: answer.text, interpretation: "모의 초기 추정이며 실제 학습 성과가 아님", unverified: ["독립 수행"], category: "diagnostic-estimate" } : null, question: index === 2 ? null : { mode: index === 0 ? "explanation" : "performance", prompt: index === 0 ? scenario.question : scenario.exercise }, readyForPlan: index === 2 });
    state = await getAdvisor(db, owner, id);
    if (state.question) await submitAdvisorAnswer(db, flowCommand(owner, state.version), id, { questionId: state.question.id, text: "아직 모르겠습니다.", materialUsed: false, hintUsed: false, answerSeen: false });
  }
  let state = await getAdvisor(db, owner, id);
  await beginStoredAdvisorAi(db, flowCommand(owner, state.version), id);
  state = await getAdvisor(db, owner, id);
  await saveAdvisorPlan(db, owner, state, { objective: scenario.question, prerequisites: ["기초 계산"], units: [{ key: "concept", title: scenario.title, objective: scenario.question, prerequisiteKeys: [], minutes: 60, selfExplanationCriterion: scenario.question, newConditionCriterion: "처음 보는 수치와 조건의 계산을 도움 없이 수행한다" }], excludedScope: ["고급 응용"], attention: ["실제 수행 미확인"] });
  state = await getAdvisor(db, owner, id);
  await confirmAdvisorPlan(db, flowCommand(owner, state.version), id, { reviewedVersion: state.version, reviewedEvidence: true, acceptedAssessment: true, acceptedScopeAndTime: true });
  const confirmed = await getAdvisor(db, owner, id);
  requireFlow(confirmed.conditions.domain === scenario.domain && confirmed.unitAssessments.every((unit): boolean => unit.selfExplanation === "미확인" && unit.newCondition === "미확인"), "분야 및 진단-성과 경계");
  return id;
}

async function prepareSource(env: LearningFlowEnvironment, owner: SiteIdentity, courseId: string, scenario: LearningFlowCase): Promise<Readonly<{ materialId: string; sourceId: string }>> {
  const text: string = learningFlowSource(scenario);
  const bytes: Uint8Array<ArrayBuffer> = new TextEncoder().encode(text);
  const digest: ArrayBuffer = await crypto.subtle.digest("SHA-256", bytes);
  const sha256: string = Array.from(new Uint8Array(digest), (value: number): string => value.toString(16).padStart(2, "0")).join("");
  await verifyMaterialInventory(env.DB, env.BUCKET, owner, Date.now());
  const transfer = await startMaterialTransfer(env.DB, owner, crypto.randomUUID(), { courseId: recordId.parse(courseId), metadata: { title: scenario.title, edition: "flow-v1", role: "textbook", kind: "text", filename: `${scenario.domain}.txt`, mime: "text/plain", bytes: bytes.length, sha256 } }, Date.now());
  const uploaded = await uploadMaterialBody(env.DB, env.BUCKET, owner, transfer.id, transfer.version, new Request("https://local.invalid/original", { method: "PUT", headers: { "content-type": "text/plain" }, body: bytes }));
  await completeMaterialTransfer(env.DB, env.BUCKET, owner, transfer.id, uploaded.version, { pdf, jpeg }, new AbortController().signal);
  const registered = await getMaterialTransfer(env.DB, owner, transfer.id);
  const original: R2ObjectBody = await readMaterialObject(env.BUCKET, registered);
  const storedText: string = await original.text();
  requireFlow(storedText === text && registered.courseId === courseId, "과정-원본 UTF-8 왕복");
  await saveExtractionSelection(env.DB, flowCommand(owner, 0), registered, buildSelection(materialFileReference(registered), "1", ""));
  const page = (await listExtractionPages(env.DB, owner, registered.materialId, 1))[0];
  const proof = await requireExtractionPage(env.DB, env.BUCKET, owner, registered.materialId, 1, 1);
  const result = requireExtractionText(proof, { filePage: 1, method: "plain-text", status: "complete", width: null, height: null, rotation: 0, segments: [{ id: "s0", kind: "text", text: storedText, bounds: null, transform: null, uncertain: false, reason: null }], error: null, requiresConfirmation: true });
  await saveTextExtraction(env.DB, flowCommand(owner, page.version), proof, page, result);
  const extracted = await getExtractionPage(env.DB, owner, page.id);
  if (!extracted.resultId) throw new Error("통합 검증 추출 결과 없음");
  await confirmExtractionSegments(env.DB, flowCommand(owner, extracted.version), proof, extracted, { selectionRevision: 1, filePage: 1, expectedVersion: extracted.version, resultId: extracted.resultId, segmentIds: ["s0"], printedPage: "1", comparedWithOriginal: true });
  const confirmed = await getExtractionPage(env.DB, owner, page.id);
  await createExtractionSource(env.DB, flowCommand(owner, confirmed.version), proof, confirmed, "s0");
  const sourceId: string | null = await env.DB.prepare("SELECT source_id FROM extraction_sources WHERE owner_id=? AND result_id=?").bind(owner.userId, confirmed.resultId).first<string>("source_id");
  if (sourceId === null) throw new Error("통합 검증 출처 없음");
  return { materialId: registered.materialId, sourceId };
}

export async function prepareLearningFlow(env: LearningFlowEnvironment, scenario: LearningFlowCase): Promise<PreparedLearningFlow> {
  const owner: SiteIdentity = { realm: "sites", userId: `flow-test:${scenario.domain}:${crypto.randomUUID()}` };
  const courseId: string = await prepareAdvisor(env.DB, owner, scenario);
  const source = await prepareSource(env, owner, courseId, scenario);
  const unit = (await listConfirmedUnits(env.DB, owner))[0];
  requireFlow(unit.courseId === courseId, "확정 과정-단원 연결");
  const link = linkInput.parse({ id: crypto.randomUUID(), planVersionId: unit.planVersionId, unitId: unit.unitId, materialId: source.materialId, toc: scenario.title, sourceRefIds: [recordId.parse(source.sourceId)], bibliography: { author: "ALTER", origin: "자체 통합 시험 자료", checked: true, evidenceSourceId: source.sourceId }, readingMinutes: 5 });
  await createMaterialLink(env.DB, env.BUCKET, flowCommand(owner, 1), link);
  return selectLearningFlowScope(env, { owner, courseId, ...source, linkId: link.id }, scenario);
}

export async function selectLearningFlowScope(env: LearningFlowEnvironment, flow: LinkedLearningFlow, scenario: LearningFlowCase): Promise<PreparedLearningFlow> {
  const { owner } = flow;
  const unit = (await listConfirmedUnits(env.DB, owner))[0];
  const input = scopeInput.parse({ id: crypto.randomUUID(), planVersionId: unit.planVersionId, unitId: unit.unitId, date: seoulStudyDate(Date.now()), availableMinutes: 30, questionMinutes: 5, practiceMinutes: 10, linkIds: [flow.linkId] });
  await createStudyScope(env.DB, env.BUCKET, flowCommand(owner, 1), input);
  await beginStoredScopeEvaluation(env.DB, env.BUCKET, flowCommand(owner, 1), input.id);
  const state = await getStudyScope(env.DB, owner, input.id);
  const evaluation = librarianOutputFixture(state);
  await saveScopeEvaluation(env.DB, env.BUCKET, owner, state, { ...evaluation, candidates: evaluation.candidates.map((candidate) => ({ ...candidate, question: { text: scenario.question, sourceRefIds: [recordId.parse(flow.sourceId)] }, exercise: { text: scenario.exercise, sourceRefIds: [recordId.parse(flow.sourceId)] } })) });
  const proposed = await getStudyScope(env.DB, owner, input.id);
  requireFlow(proposed.phase === "proposed" && proposed.selection?.minutes === 20, "최소 자료·시간 제안");
  await confirmStoredScope(env.DB, env.BUCKET, flowCommand(owner, proposed.version), input.id, { reviewedVersion: proposed.version, reviewedSources: true, acceptedTime: true, acceptedAssessment: true });
  const bundle = await readTutorBundle(env.DB, env.BUCKET, owner, input.id);
  requireFlow(bundle.sources.length === 1 && bundle.sources[0].evidence === learningFlowSource(scenario) && bundle.question.text === scenario.question && bundle.exercise.text === scenario.exercise, "자료-질문-연습-출처 연결");
  return { ...flow, scopeId: input.id };
}
