import { z } from "zod";
import { performance,progress,recordId,version,timestamp } from "../domain/contracts.ts";

export const resultEvidence=z.object({sessionId:recordId,sessionVersion:version,answerId:recordId,answerVersion:version.nullable(),questionId:recordId,kind:z.enum(["self-explanation","new-condition"]),accepted:z.boolean(),reasons:z.array(z.string().min(1)),observation:z.string(),helpIds:z.array(recordId)}).strict();
export type ResultEvidence=Readonly<z.infer<typeof resultEvidence>>;
export const resultJudgment=z.object({unitPassed:z.boolean(),delayedRecall:z.enum(["미확인","확인"]),progress,performance,explanation:resultEvidence.nullable(),variation:resultEvidence.nullable(),evidence:z.array(resultEvidence),nextAction:z.string().min(1)}).strict();
export type ResultJudgment=Readonly<z.infer<typeof resultJudgment>>;
export const resultDraft=z.object({id:recordId,version,sessionVersion:version,title:z.string(),editor:z.boolean(),phase:z.string(),officialVersion:z.number().int().nonnegative(),fingerprint:z.string().regex(/^[a-f0-9]{64}$/),judgment:resultJudgment,helpCount:z.number().int().nonnegative(),errors:z.array(z.string()),canConfirm:z.boolean(),issues:z.array(z.string()),confirmation:z.object({id:recordId,resultId:recordId,version,confirmedAt:timestamp,judgment:resultJudgment}).strict().nullable(),latest:z.object({id:recordId,version,performance,progress,nextAction:z.string().nullable(),correctionId:recordId.nullable()}).strict().nullable(),reviews:z.array(z.object({id:recordId,version,correctionId:recordId.nullable(),nextAction:z.string(),recheckState:z.string()}).strict())}).strict();
export type ResultDraft=Readonly<z.infer<typeof resultDraft>>;
export const resultRequest=z.object({id:recordId,expectedVersion:version,expectedSessionVersion:version,expectedOfficialVersion:z.number().int().nonnegative(),fingerprint:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type ResultRequest=Readonly<z.infer<typeof resultRequest>>;
