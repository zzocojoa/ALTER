import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "vite";
import { Miniflare } from "miniflare";
import { z } from "zod";
import { learningFlowCases } from "../tests/fixtures/learning-flow-cases.ts";

const reportSchema = z.object({ status: z.literal("passed"), environment: z.literal("local-workerd-d1-r2"), domain: z.enum(["major", "certification", "practical"]), title: z.string(), providerEvidence: z.literal("deterministic-mock-only"), sourceKind: z.literal("self-authored-utf8-text"), actualBrowser: z.literal(false), actualPhone: z.literal(false), owner: z.string(), courseId: z.string().uuid(), materialId: z.string().uuid(), sourceId: z.string().uuid(), tutorId: z.string().uuid(), editorId: z.string().uuid(), checks: z.array(z.string()).length(33) }).strict();
const output: string = path.resolve(".sites-runtime/learning-flow");
await build({ configFile: false, logLevel: "warn", plugins: [{ name: "learning-flow-wasm", enforce: "pre", resolveId(source: string) { return source.endsWith(".wasm") ? { id: `./${path.basename(source)}`, external: true } : null; } }], ssr: { noExternal: true, external: ["node:buffer", "node:crypto", "node:stream", "node:stream/promises", "node:zlib"], target: "webworker" }, build: { ssr: "tests/fixtures/learning-flow-worker.ts", target: "es2022", outDir: output, emptyOutDir: true, rollupOptions: { output: { entryFileNames: "worker.mjs" } } } });
await copyFile("lib/materials/pdf-wasm/validator.wasm", path.join(output, "validator.wasm"));
await copyFile("lib/materials/jpeg-wasm/decoder.wasm", path.join(output, "decoder.wasm"));
const runtime: Miniflare = new Miniflare({ modules: true, modulesRules: [{ type: "CompiledWasm", include: ["**/*.wasm"], fallthrough: true }], scriptPath: path.join(output, "worker.mjs"), compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"], r2Buckets: ["BUCKET"], d1Databases: ["DB"], d1Persist: false, r2Persist: false, cf: false, outboundService: async (request: Request): Promise<Response> => { throw new Error(`통합 시험은 외부 통신을 허용하지 않습니다: ${request.method} ${new URL(request.url).origin}`); } });
try {
  const db = await runtime.getD1Database("DB");
  const journal = z.object({ entries: z.array(z.object({ tag: z.string() })) }).parse(JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8")));
  for (const entry of journal.entries) for (const statement of (await readFile(`drizzle/${entry.tag}.sql`, "utf8")).split("--> statement-breakpoint").map((part: string): string => part.trim()).filter(Boolean)) await db.prepare(statement).run();
  const scenarios: z.infer<typeof reportSchema>[] = [];
  for (const scenario of learningFlowCases) {
    const response = await runtime.dispatchFetch(`https://local.invalid/${scenario.domain}`, { method: "POST" });
    const body: string = await response.text();
    assert.equal(response.status, 200, body);
    const result = reportSchema.parse(JSON.parse(body));
    assert.equal(result.domain, scenario.domain);
    assert.equal(result.title, scenario.title);
    assert.equal(new Set(result.checks).size, result.checks.length);
    scenarios.push(result);
    console.log(JSON.stringify({ domain: result.domain, status: result.status, checks: result.checks.length }));
  }
  assert.equal(new Set(scenarios.map((item): string => item.owner)).size, 3);
  const report = { status: "passed", checkedAt: new Date().toISOString(), environment: "local-workerd-d1-r2", actualProviderCalls: 0, externalNetwork: "blocked-by-runtime", inputSha256: createHash("sha256").update(await readFile("tests/fixtures/learning-flow-cases.ts")).digest("hex"), coverage: "Three self-authored text courses through Advisor, R2, extraction, Librarian, Tutor, Editor, result confirmation and review linkage. Model responses are deterministic mocks; browser/phone/real-provider evidence remains separate.", scenarios };
  await writeFile(".taskmaster/reports/task-18-learning-flow-local.json", JSON.stringify(report, null, 2) + "\n");
} finally { await runtime.dispose(); }
