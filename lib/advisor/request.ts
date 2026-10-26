import { z } from "zod";
import { recordId, version } from "../domain/contracts.ts";
import { learningConditions } from "./conditions.ts";
import { planProposal, submittedDiagnosis } from "./contracts.ts";
import { confirmationChoices } from "../../db/repositories/advisor.ts";

const action = z.object({ id: recordId, expectedVersion: version });
export const advisorAction = z.discriminatedUnion("action", [
  action.extend({ action: z.literal("start"), conditions: learningConditions }).strict(),
  action.extend({ action: z.literal("answer"), answer: submittedDiagnosis }).strict(),
  action.extend({ action: z.literal("generate") }).strict(),
  action.extend({ action: z.literal("recover") }).strict(),
  action.extend({ action: z.literal("edit"), proposal: planProposal }).strict(),
  action.extend({ action: z.literal("confirm"), choices: confirmationChoices }).strict(),
]);
export type AdvisorAction = Readonly<z.infer<typeof advisorAction>>;
