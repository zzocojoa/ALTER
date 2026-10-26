import { domainFailure } from "../domain/contracts.ts";
import type { LinkedMaterial, SourceExcerpt } from "./contracts.ts";

/** 외부 서지는 본문 출처와 별개로 확인하며 판본 미상은 확인한 판본으로 바꾸지 않습니다. */
export function requireBibliographyEvidence(link: LinkedMaterial, sources: readonly SourceExcerpt[]): void {
  const bib = link.bibliography;
  if (!bib.checked) {
    if (bib.evidenceSourceId !== null || bib.external !== undefined) throw domainFailure("validation", "librarian.bibliography-unverified", null);
    return;
  }
  if (!bib.author || !bib.origin) throw domainFailure("validation", "librarian.bibliography-evidence-required", null);
  if (bib.external) {
    const proof = bib.external;
    const terms: readonly string[] = [proof.title, bib.author, bib.origin, ...(proof.edition === null ? [] : [proof.edition])];
    if (bib.evidenceSourceId !== null || sources.some(source => source.id === proof.id) || (proof.kind === "publisher" && proof.url === null) || terms.some(term => !proof.evidence.includes(term))) throw domainFailure("validation", "librarian.external-bibliography-evidence-required", null);
    return;
  }
  const proof = sources.find(source => source.id === bib.evidenceSourceId);
  if (!link.metadata.edition || !proof || [bib.author, bib.origin, link.metadata.edition].some(term => !proof.evidence.includes(term))) throw domainFailure("validation", "librarian.bibliography-evidence-required", null);
}
