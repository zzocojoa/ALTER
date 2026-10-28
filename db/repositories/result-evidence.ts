import { domainFailure } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import { resultEvidenceDetail, resultEvidenceQuery } from "../../lib/results/evidence-detail.ts";
import type { ResultEvidenceDetail, ResultEvidenceQuery } from "../../lib/results/evidence-detail.ts";
import { readResultSnapshot } from "./result-draft.ts";
import { requireTutorViewAccess } from "./tutor.ts";

/** 결과에 실제 연결된 동일 소유자의 답안만 읽고 원문 본문은 별도 인증 경로로 남깁니다. */
export async function readResultEvidence(db: D1Database, owner: SiteIdentity, input: ResultEvidenceQuery): Promise<ResultEvidenceDetail> {
  const query = resultEvidenceQuery.parse(input);
  const snapshot = await readResultSnapshot(db, owner, query.resultId);
  if (snapshot.draft.fingerprint !== query.fingerprint) throw domainFailure("version_conflict", "result.evidence-snapshot-changed", null);
  const judgment = snapshot.draft.confirmation?.judgment ?? snapshot.draft.judgment;
  const evidence = judgment.evidence.find((item): boolean => item.answerId === query.answerId);
  if (!evidence) throw domainFailure("reference_conflict", "result.evidence-not-linked", null);
  await requireTutorViewAccess(db, owner, evidence.sessionId);
  const state = snapshot.states.find((item): boolean => item.id === evidence.sessionId);
  const answer = state?.answers.find((item): boolean => item.id === evidence.answerId && item.questionId === evidence.questionId);
  const fact = snapshot.facts.find((item): boolean => item.id === evidence.answerId && item.sessionId === evidence.sessionId);
  const question = state?.questions.find((item): boolean => item.id === evidence.questionId);
  if (!state || !answer || !fact || !question || evidence.answerVersion !== fact.version || (answer.text.length > 0 ? answer.text : "[사진 답안]") !== fact.text || fact.questionId !== question.id || fact.attemptId !== answer.attemptId) throw domainFailure("reference_conflict", "result.evidence-answer-version-mismatch", null);
  return resultEvidenceDetail.parse({ resultId: query.resultId, fingerprint: query.fingerprint, evidence,
    question: { id: question.id, prompt: question.prompt, criterion: evidence.kind === "self-explanation" ? state.start.bundle.unit.selfExplanationCriterion : state.start.bundle.unit.newConditionCriterion },
    answer: { id: answer.id, version: fact.version, text: answer.text, fileIds: answer.fileIds, submittedAt: answer.submittedAt },
    sources: state.start.bundle.sources.map(({ id, materialId, filePage, printedPage, spanStart, spanEnd }) => ({ id, materialId, filePage, printedPage, spanStart, spanEnd })),
  });
}
