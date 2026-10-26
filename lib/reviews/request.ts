import { z } from "zod";
import { recordId,studyDate,version } from "../domain/contracts.ts";
import { learningType,reviewConditions } from "./contracts.ts";
const existing=z.object({id:recordId,expectedVersion:version});
export const reviewAction=z.discriminatedUnion("action",[
  existing.extend({action:z.literal("prepare")}).strict(),
  existing.extend({action:z.literal("choose"),type:learningType,conditions:reviewConditions,dueDate:studyDate,reason:z.string().trim().min(1).max(2000)}).strict(),
  existing.extend({action:z.literal("start"),reviewId:recordId,questionId:recordId,attemptId:recordId}).strict(),
  existing.extend({action:z.literal("correct"),correctionId:recordId,reason:z.string().trim().min(1).max(2000),evidence:z.string().trim().min(1).max(6000),question:z.string().trim().min(1).max(2000),explanation:z.string().trim().min(1).max(2000),nextAction:z.string().trim().min(1).max(2000),targets:z.array(z.object({reviewId:recordId,expectedVersion:version}).strict()).min(1).max(200)}).strict(),
]);
export type ReviewAction=Readonly<z.infer<typeof reviewAction>>;
