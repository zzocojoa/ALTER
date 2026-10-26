import { requireBibliographyEvidence } from "./bibliography.ts";
import { requireSourceQuote } from "./citations.ts";
import { domainFailure } from "../domain/contracts.ts";
import { librarianEvaluation, requireDistinct } from "./contracts.ts";
import type { CandidateEvaluation, CandidateSnapshot, ConfirmedUnit, LibrarianEvaluation } from "./contracts.ts";

/** 판단과 정확한 원문 인용을 대조하며 서지정보 확인과 본문 확인을 분리합니다. */
export function validateLibrarianEvaluation(value: LibrarianEvaluation, unit: ConfirmedUnit, candidates: readonly CandidateSnapshot[]): void {
  librarianEvaluation.parse(value);
  requireDistinct(value.candidates.map((item): string => item.linkId), "librarian.evaluation-duplicate");
  if (value.objective !== unit.objective || value.candidates.length !== candidates.length) throw domainFailure("reference_conflict", "librarian.evaluation-goal", null);
  for (const item of value.candidates) {
    const candidate = candidates.find((known): boolean => known.link.id === item.linkId);
    if (!candidate) throw domainFailure("reference_conflict", "librarian.evaluation-unknown-candidate", null);
    requireDistinct(item.coverage, "librarian.coverage-duplicate");
    requireDistinct(item.coverageEvidence.map((entry): string => JSON.stringify([entry.role, entry.sourceRefId, entry.quote])), "librarian.coverage-evidence-duplicate");
    if (candidate.valid) requireBibliographyEvidence(candidate.link, candidate.sources);
    const axes = [item.reliability, item.difficulty, item.relevance];
    if (!candidate.valid && (axes.some((axis): boolean => axis.judgment !== "unverified") || item.coverage.length > 0 || item.question !== null || item.exercise !== null)) throw domainFailure("reference_conflict", "librarian.unverified-body", null);
    for (const key of ["reliability", "difficulty", "relevance"] as const) {
      const axis = item[key];
      if (axis.judgment !== "unverified" && axis.citations.length === 0) throw domainFailure("reference_conflict", "librarian.axis-evidence-required", null);
      for (const citation of axis.citations) {
        const external = candidate.link.bibliography.external;
        if (key === "reliability" && external && citation.sourceRefId === external.id) {
          if (!citation.quote.trim() || !external.evidence.includes(citation.quote)) throw domainFailure("reference_conflict", "librarian.external-quote-outside-evidence", null);
        } else validateQuote(candidate, citation.sourceRefId, citation.quote);
      }
    }
    if (item.reliability.judgment === "supported" && (!candidate.link.bibliography.checked || !item.reliability.citations.some((citation): boolean => citation.sourceRefId === (candidate.link.bibliography.external?.id ?? candidate.link.bibliography.evidenceSourceId)))) throw domainFailure("reference_conflict", "librarian.unverified-bibliography", null);
    if (item.coverage.some((role): boolean => !item.coverageEvidence.some((entry): boolean => entry.role === role)) || item.coverageEvidence.some((entry): boolean => !item.coverage.includes(entry.role))) throw domainFailure("reference_conflict", "librarian.coverage-evidence", null);
    for (const entry of item.coverageEvidence) validateQuote(candidate, entry.sourceRefId, entry.quote);
    for (const element of [item.question, item.exercise]) {
      if (!element) continue;
      requireDistinct(element.sourceRefIds, "librarian.element-sources");
      if (element.sourceRefIds.some((id): boolean => !candidate.sources.some((source): boolean => source.id === id))) throw domainFailure("reference_conflict", "librarian.element-outside-source", null);
    }
    if (item.coverage.includes("explanation") && !item.question || item.coverage.includes("practice") && !item.exercise) throw domainFailure("reference_conflict", "librarian.learning-element-required", null);
  }
}
function validateQuote(candidate: CandidateSnapshot, id: string, quote: string): void {
  requireSourceQuote(candidate.sources,id,quote,"librarian.quote-outside-source");
}
/** 난도 적합성은 자기 보고에 대한 제안이며 실제 능력 판정으로 사용하지 않습니다. */
export function eligibleEvaluation(evaluation: CandidateEvaluation, candidate: CandidateSnapshot): boolean {
  return candidate.valid && evaluation.reliability.judgment === "supported" && evaluation.difficulty.judgment === "supported" && evaluation.relevance.judgment === "supported" && evaluation.coverage.length > 0;
}
