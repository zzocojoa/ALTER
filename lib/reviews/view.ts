import { z } from "zod";
import { recordId,version } from "../domain/contracts.ts";
import { errorEvidence,reviewTask,intervalProposal,proposalDecision } from "./contracts.ts";
export const savedReviewPlan=z.object({id:recordId,version,reviewVersion:version,errorId:recordId,errorVersion:version,sourceRefId:recordId,unitId:recordId,title:z.string(),question:z.string(),explanation:z.string(),nextAction:z.string(),correctionId:recordId.nullable(),recheckState:z.string(),evidence:errorEvidence,task:reviewTask,proposalId:recordId,basisResultVersionId:recordId,proposal:intervalProposal,decision:proposalDecision,sessionId:recordId.nullable(),sessionPhase:z.string().nullable(),dueState:z.enum(["proposed","future","today","overdue","recheck","complete"])}).strict();
export type SavedReviewPlan=Readonly<z.infer<typeof savedReviewPlan>>;
export const reviewOverview=z.object({today:z.string(),plans:z.array(savedReviewPlan),legacy:z.array(z.object({id:recordId,version,title:z.string()}).strict())}).strict();
export type ReviewOverview=Readonly<z.infer<typeof reviewOverview>>;
