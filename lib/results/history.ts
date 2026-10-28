import { z } from "zod";
import { recordId, version, timestamp } from "../domain/contracts.ts";

export const resultHistoryItem = z.object({ id: recordId, version, title: z.string(), confirmedOrdinal: version.nullable(), confirmedAt: timestamp.nullable() }).strict();
export type ResultHistoryItem = Readonly<z.infer<typeof resultHistoryItem>>;
