import assert from "node:assert/strict";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { build } from "vite";
import { Miniflare } from "miniflare";
import type { SdkProbeReport } from "../tests/fixtures/ai-sdk-probe.ts";

const outputDirectory: string = path.resolve(".sites-runtime/ai-sdk-check");
const packageData: { version: string } = JSON.parse(await readFile("node_modules/openai/package.json", "utf8"));
assert.equal(packageData.version, "7.43.0");
await build({ configFile: false, logLevel: "warn", ssr: { noExternal: true, target: "webworker" }, build: { ssr: "tests/fixtures/ai-sdk-worker.ts", target: "es2022", outDir: outputDirectory, emptyOutDir: true, rollupOptions: { output: { entryFileNames: "worker.mjs" } } } });
const runtime: Miniflare = new Miniflare({ modules: true, scriptPath: path.join(outputDirectory, "worker.mjs"), compatibilityDate: "2026-05-15", cf: false });
try {
  const response = await runtime.dispatchFetch("https://local.invalid/sdk-probe");
  assert.equal(response.status, 200);
  const report: SdkProbeReport = await response.json() as SdkProbeReport;
  assert.deepEqual(report, { environment: "mock", model: "gpt-6-luna", strictFormat: true, image: true, responseId: "resp_fixture", usageBeforeParseFailure: 16, parseRejected: true, streamEvents: 1, sdkRetries: 0, https: true });
  const evidence: object = { status: "passed", runtime: "local-workerd", sdkVersion: packageData.version, report, realAccountAccess: "not-run", paidCalls: 0, liveHttps: "not-run", checkedAt: new Date().toISOString() };
  await writeFile(".taskmaster/reports/task-4-sdk.json", JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence));
} finally { await runtime.dispose(); }
