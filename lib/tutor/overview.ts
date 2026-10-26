import { z } from "zod";
import { recordId,version } from "../domain/contracts.ts";
import { tutorView } from "./view.ts";
export const tutorOverview=z.object({history:z.array(z.object({id:recordId,version,title:z.string(),phase:tutorView.shape.phase})),scopes:z.array(z.object({id:recordId,title:z.string(),date:z.string()}))}).strict();
export type TutorOverview=Readonly<z.infer<typeof tutorOverview>>;
