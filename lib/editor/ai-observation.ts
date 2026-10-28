import { z } from "zod";
import { recordId, version } from "../domain/contracts.ts";
import { tutorAiObservation } from "../tutor/ai-observation.ts";
import { editorView } from "./view.ts";

export const editorAiAction = z.object({ action: z.enum(["feedback", "review", "variation", "recover"]), id: recordId, expectedVersion: version }).strict();
export const editorAiIntent = z.object({ key: recordId, input: editorAiAction }).strict();
export type EditorAiIntent = Readonly<z.infer<typeof editorAiIntent>>;
export const editorAiObservationReply = z.object({ view: editorView, observation: tutorAiObservation }).strict();
