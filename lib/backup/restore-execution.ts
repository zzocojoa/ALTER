import { z } from "zod";
import { recordId, timestamp } from "../domain/contracts.ts";

export const restoredExecution = z.object({ runId: recordId.nullable(), activatedAt: timestamp.nullable(), learning: z.enum(["quarantined", "active"]), externalAuthority: z.literal("unverified") }).strict();
export type RestoredExecution = Readonly<z.infer<typeof restoredExecution>>;
