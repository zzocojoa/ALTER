import { z } from "zod";
import { recordId,version } from "../domain/contracts.ts";
import { weeklyConfirm } from "./confirmation.ts";
import { weeklyEdit,weeklyStart } from "./workspace.ts";
const selected=z.object({id:recordId,expectedVersion:version}).strict();
export const weeklyAction=z.discriminatedUnion("action",[
  z.object({action:z.literal("start"),input:weeklyStart}).strict(),
  weeklyConfirm.extend({action:z.literal("confirm")}).strict(),
  weeklyConfirm.extend({action:z.literal("confirm-local")}).strict(),
  selected.extend({action:z.literal("save"),input:weeklyEdit}).strict(),
  selected.extend({action:z.literal("time"),availableMinutes:weeklyEdit.shape.availableMinutes}).strict(),
  selected.extend({action:z.literal("refresh")}).strict(),
  selected.extend({action:z.literal("generate")}).strict(),
  selected.extend({action:z.literal("recover")}).strict(),
  selected.extend({action:z.literal("reset-generation")}).strict(),
]);
export type WeeklyAction=z.infer<typeof weeklyAction>;
