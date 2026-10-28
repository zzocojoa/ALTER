import { z } from "zod";
import { recordId, timestamp, version } from "../domain/contracts.ts";
import { resultEvidence } from "./contracts.ts";
import { sourceExcerpt } from "../librarian/contracts.ts";

export const resultEvidenceQuery = z.object({ resultId: recordId, answerId: recordId, fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type ResultEvidenceQuery = Readonly<z.infer<typeof resultEvidenceQuery>>;
export const resultEvidenceDetail = z.object({
  resultId: recordId, fingerprint: resultEvidenceQuery.shape.fingerprint, evidence: resultEvidence,
  question: z.object({ id: recordId, prompt: z.string(), criterion: z.string() }).strict(),
  answer: z.object({ id: recordId, version, text: z.string().max(60000), fileIds: z.array(recordId).max(4), submittedAt: timestamp }).strict(),
  sources: z.array(sourceExcerpt.pick({ id: true, materialId: true, filePage: true, printedPage: true, spanStart: true, spanEnd: true })).max(96),
}).strict();
export type ResultEvidenceDetail = Readonly<z.infer<typeof resultEvidenceDetail>>;
