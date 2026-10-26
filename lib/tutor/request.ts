import { z } from "zod";
import { recordId,version } from "../domain/contracts.ts";
import { tutorDraft } from "./contracts.ts";
const existing=z.object({id:recordId,expectedVersion:version});
export const tutorStorageAction=z.discriminatedUnion("action",[
  z.object({action:z.literal("start"),id:recordId,scopeId:recordId,questionId:recordId,attemptId:recordId}).strict(),
  existing.extend({action:z.literal("draft"),draft:tutorDraft}).strict(),
  existing.extend({action:z.literal("submit"),answerId:recordId,draft:tutorDraft}).strict(),
  existing.extend({action:z.literal("recall")}).strict(),existing.extend({action:z.literal("direct")}).strict(),
  existing.extend({action:z.literal("revise"),attemptId:recordId}).strict(),existing.extend({action:z.literal("pause")}).strict(),existing.extend({action:z.literal("resume")}).strict(),existing.extend({action:z.literal("finish")}).strict(),
]);
export type TutorStorageAction=Readonly<z.infer<typeof tutorStorageAction>>;
export const tutorAiAction=z.discriminatedUnion("action",[existing.extend({action:z.literal("lesson")}).strict(),existing.extend({action:z.literal("diagnose")}).strict(),existing.extend({action:z.literal("recover")}).strict(),existing.extend({action:z.literal("help")}).strict(),existing.extend({action:z.literal("variation")}).strict()]);
export const tutorAction=z.union([tutorStorageAction,tutorAiAction]);
export type TutorAction=Readonly<z.infer<typeof tutorAction>>;
