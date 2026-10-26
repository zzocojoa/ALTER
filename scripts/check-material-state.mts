import { readFile, writeFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { runMaterialStateAcceptance } from "../lib/materials/state-acceptance.ts";

const runtime: Miniflare = new Miniflare({ modules: true, script: "export default {fetch() {return new Response('material-state');}}", compatibilityDate: "2026-05-15", d1Databases: ["DB"], d1Persist: false, cf: false });
try {
  const db: D1Database = await runtime.getD1Database("DB") as unknown as D1Database;
  const journal: { entries: { tag: string }[] } = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
  for (const entry of journal.entries) for (const statement of (await readFile(`drizzle/${entry.tag}.sql`, "utf8")).split("--> statement-breakpoint").map((part: string): string => part.trim()).filter(Boolean)) await db.prepare(statement).run();
  const result = await runMaterialStateAcceptance(db, "local-workerd");
  await writeFile(".taskmaster/reports/task-5-state-local.json", JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
} finally { await runtime.dispose(); }
