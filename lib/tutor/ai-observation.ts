import { z } from "zod";
import { recordId } from "../domain/contracts.ts";
import { tutorAiAction } from "./request.ts";
import { tutorView } from "./view.ts";

export const tutorAiIntent = z.object({ key: recordId, input: tutorAiAction }).strict();
export type TutorAiIntent = Readonly<z.infer<typeof tutorAiIntent>>;
export const tutorAiObservation = z.object({ key: recordId, status: z.enum(["unobserved", "pending", "completed"]), logicalKey: z.string().nullable(), requestId: recordId.nullable(), version: z.number().int().positive().nullable() }).strict();
export type TutorAiObservation = Readonly<z.infer<typeof tutorAiObservation>>;
export const tutorAiObservationReply = z.object({ view: tutorView, observation: tutorAiObservation }).strict();
