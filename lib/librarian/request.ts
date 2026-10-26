import { z } from "zod";
import { recordId, version } from "../domain/contracts.ts";
import { linkInput, scopeInput } from "./contracts.ts";
import { scopeConfirmation } from "../../db/repositories/study-scopes.ts";

const action = z.object({ id: recordId, expectedVersion: version });
export const librarianAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("link"), link: linkInput }).strict(),
  z.object({ action: z.literal("start"), input: scopeInput }).strict(),
  action.extend({ action: z.literal("generate") }).strict(),
  action.extend({ action: z.literal("recover") }).strict(),
  action.extend({ action: z.literal("confirm"), choices: scopeConfirmation }).strict(),
]);
export type LibrarianAction = Readonly<z.infer<typeof librarianAction>>;
