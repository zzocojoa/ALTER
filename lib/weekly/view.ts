import { z } from "zod";
import { weeklyWorkspace } from "./workspace.ts";
import { weeklyGenerationRecovery } from "./recovery.ts";
export const weeklyVersionSummary=z.object({id:z.string().uuid(),ordinal:z.number().int().positive(),confirmedAt:z.number(),exportState:z.string()}).strict();
export const weeklyView=z.object({state:weeklyWorkspace,current:z.boolean(),issue:z.string().nullable(),versions:z.array(weeklyVersionSummary).max(100),generationRecovery:weeklyGenerationRecovery}).strict();
export const weeklyFrozen=z.object({state:weeklyWorkspace,confirmedAt:z.number(),exportState:z.string(),current:z.boolean(),issue:z.string().nullable()}).strict();
export type WeeklyFrozen=z.infer<typeof weeklyFrozen>;
export type WeeklyView=z.infer<typeof weeklyView>;
