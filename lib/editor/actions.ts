import { z } from "zod";
import { recordId,version } from "../domain/contracts.ts";
import { tutorDraft } from "../tutor/contracts.ts";
const existing=z.object({id:recordId,expectedVersion:version});
export const editorAction=z.discriminatedUnion("action",[
  z.object({action:z.literal("start"),id:recordId,scopeId:recordId,questionId:recordId,attemptId:recordId}).strict(),
  z.object({action:z.literal("revisit"),id:recordId,originalId:recordId,originalVersion:version,questionId:recordId,attemptId:recordId}).strict(),
  existing.extend({action:z.literal("draft"),draft:tutorDraft}).strict(),
  existing.extend({action:z.literal("submit"),answerId:recordId,draft:tutorDraft}).strict(),
  existing.extend({action:z.literal("revision-draft"),draft:tutorDraft,reason:z.string().max(4000)}).strict(),
  existing.extend({action:z.literal("revision-submit"),answerId:recordId,attemptId:recordId,draft:tutorDraft,reason:z.string().trim().min(1).max(4000)}).strict(),
  existing.extend({action:z.literal("finish")}),existing.extend({action:z.literal("variation")}).strict(),existing.extend({action:z.literal("cancel")}).strict(),existing.extend({action:z.literal("review")}).strict(),existing.extend({action:z.literal("feedback")}).strict(),existing.extend({action:z.literal("recover")}).strict(),
]);
export type EditorAction=Readonly<z.infer<typeof editorAction>>;
