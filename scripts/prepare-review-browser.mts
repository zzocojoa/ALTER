import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile } from "node:fs/promises";
import path from "node:path";
import { build } from "vite";
import { Miniflare } from "miniflare";
import { readablePdf } from "../tests/fixtures/pdf-bytes.ts";

const state: string | undefined = process.env.ALTER_BROWSER_STATE_DIRECTORY;
if (!state || !state.includes("/.sites-runtime/browser-state-")) throw new Error("격리된 로컬 브라우저 검사 경로가 필요해요.");
const output: string = path.resolve(".sites-runtime/review-browser-setup");
await build({ configFile: false, logLevel: "warn", plugins: [{ name: "extraction-test-wasm", enforce: "pre", resolveId(source: string) { if (source.endsWith(".wasm")) return { id: `./${path.basename(source)}`, external: true }; return null; } }], ssr: { noExternal: true, external: ["node:crypto", "node:stream", "node:stream/promises", "node:zlib"], target: "webworker" }, build: { ssr: "tests/fixtures/review-browser-setup-worker.ts", target: "es2022", outDir: output, emptyOutDir: true, rollupOptions: { output: { entryFileNames: "worker.mjs" } } } });
await copyFile("lib/materials/pdf-wasm/validator.wasm", path.join(output, "validator.wasm"));
await copyFile("lib/materials/jpeg-wasm/decoder.wasm", path.join(output, "decoder.wasm"));
const runtime: Miniflare = new Miniflare({ modules: true, modulesRules: [{ type: "CompiledWasm", include: ["**/*.wasm"], fallthrough: true }], scriptPath: path.join(output, "worker.mjs"), compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"], r2Buckets: { BUCKET: "site-creator-r2" }, d1Databases: { DB: "00000000-0000-4000-8000-000000000000" }, d1Persist: path.join(state,"v3/d1"), r2Persist: path.join(state,"v3/r2"), cf: false });
try {
  const bytes: Uint8Array = readablePdf(1);
  const response = await runtime.dispatchFetch("https://local.invalid/extraction", { method: "PUT", body: bytes, headers: { "content-type": "application/pdf", "x-fixture-kind": "pdf", "x-fixture-edition": "fixture-v1", "x-fixture-filename": "pages.pdf", "x-fixture-bytes": String(bytes.length), "x-fixture-sha256": createHash("sha256").update(bytes).digest("hex") } });
  const text: string = await response.text(); assert.equal(response.status, 200, text);
  const result: unknown = JSON.parse(text);
  console.log(JSON.stringify(result));
} finally { await runtime.dispose(); }
