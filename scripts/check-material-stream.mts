import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { Hash } from "node:crypto";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { build } from "vite";
import { Miniflare } from "miniflare";
import { materialPolicy } from "../lib/materials/policy.ts";
import type { MaterialKind } from "../lib/materials/policy.ts";
import type { MaterialStreamWorkerReport, MaterialStreamWorkerFailure } from "../tests/fixtures/material-stream-worker.ts";

const outputDirectory: string = path.resolve(".sites-runtime/material-stream-check");
await build({ configFile: false, logLevel: "warn", ssr: { noExternal: true, external: ["node:crypto"], target: "webworker" }, build: { ssr: "tests/fixtures/material-stream-worker.ts", target: "es2022", outDir: outputDirectory, emptyOutDir: true, rollupOptions: { output: { entryFileNames: "worker.mjs" } } } });
const runtime: Miniflare = new Miniflare({ modules: true, scriptPath: path.join(outputDirectory, "worker.mjs"), compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"], r2Buckets: ["BUCKET"], cf: false });

function sha256(bytes: number): string {
  const digest: Hash = createHash("sha256");
  for (let offset: number = 0; offset < bytes; offset += materialPolicy.streamChunkBytes) digest.update(new Uint8Array(Math.min(materialPolicy.streamChunkBytes, bytes - offset)).fill(97));
  return digest.digest("hex");
}
async function* body(bytes: number): AsyncGenerator<Uint8Array> {
  for (let offset: number = 0; offset < bytes; offset += materialPolicy.streamChunkBytes) yield new Uint8Array(Math.min(materialPolicy.streamChunkBytes, bytes - offset)).fill(97);
}
function headers(kind: MaterialKind, bytes: number, checksum: string): Record<string, string> {
  const types: Readonly<Record<MaterialKind, Readonly<{ name: string; mime: string }>>> = { pdf: { name: "fixture.pdf", mime: "application/pdf" }, image: { name: "fixture.png", mime: "image/png" }, text: { name: "fixture.txt", mime: "text/plain" } };
  return { "x-fixture-kind": kind, "x-fixture-name": types[kind].name, "x-fixture-mime": types[kind].mime, "x-fixture-bytes": String(bytes), "x-fixture-sha256": checksum };
}

type PassedTransfer = Readonly<{ kind: MaterialKind; bytes: number; result: MaterialStreamWorkerReport }>;
type RejectedTransfer = Readonly<{ name: string; status: number; result: MaterialStreamWorkerFailure }>;
const passed: PassedTransfer[] = [];
const rejected: RejectedTransfer[] = [];
try {
  for (const kind of ["text", "image", "pdf"] as const) {
    const maximum: number = materialPolicy.types[kind].maximumBytes;
    for (const bytes of [maximum - 1, maximum]) {
      const checksum: string = sha256(bytes);
      const response = await runtime.dispatchFetch("https://local.invalid/transfer", { method: "PUT", headers: headers(kind, bytes, checksum), body: body(bytes), duplex: "half" });
      const result: MaterialStreamWorkerReport = await response.json() as MaterialStreamWorkerReport;
      assert.equal(response.status, 200, JSON.stringify(result));
      for (const proof of [result.upload, result.download]) {
        assert.equal(proof.bytes, bytes); assert.equal(proof.sha256, checksum);
        assert.ok(proof.maximumReadBytes <= materialPolicy.streamChunkBytes);
        assert.ok(proof.maximumReadBufferBytes <= materialPolicy.streamChunkBytes);
      }
      assert.equal(result.objectBytes, bytes); assert.equal(result.contentLength, null);
      assert.equal(result.completedObjects, 1); assert.equal(result.cleaned, true);
      passed.push({ kind, bytes, result });
    }
  }
  const expectedBytes: number = 131072;
  const checksum: string = sha256(expectedBytes);
  for (const scenario of [{ name: "short-body", bytes: expectedBytes - 1, sha256: checksum, code: "material_body_length_invalid", status: 400 }, { name: "long-body", bytes: expectedBytes + 1, sha256: checksum, code: "material_body_length_invalid", status: 400 }, { name: "checksum-mismatch", bytes: expectedBytes, sha256: "0".repeat(64), code: "material_checksum_mismatch", status: 422 }]) {
    const response = await runtime.dispatchFetch("https://local.invalid/transfer", { method: "PUT", headers: headers("pdf", expectedBytes, scenario.sha256), body: body(scenario.bytes), duplex: "half" });
    const result: MaterialStreamWorkerFailure = await response.json() as MaterialStreamWorkerFailure;
    assert.equal(response.status, scenario.status, JSON.stringify(result)); assert.equal(result.code, scenario.code);
    assert.equal(result.completedObjects, 0); assert.equal(result.abortedMultipart, true);
    rejected.push({ name: scenario.name, status: response.status, result });
  }
  const evidence = { status: "passed", runtime: "local-workerd", checkedAt: new Date().toISOString(), successfulTransfers: passed, rejectedTransfers: rejected, tests: passed.length + rejected.length, maximumApplicationReadBufferBytes: materialPolicy.streamChunkBytes, wholeIsolateMemoryMeasured: false, scope: "request body streaming and incremental SHA-256 through local R2 multipart; synthetic bytes are not valid PDF/image content", actualSitesGatewayVerified: false, actualSitesQuotaVerified: false, contentValidationVerified: false, hostedWrites: 0, openAiCalls: 0 };
  await writeFile(".taskmaster/reports/task-5-stream-local.json", JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify({ status: evidence.status, tests: evidence.tests, maximumBytes: materialPolicy.types.pdf.maximumBytes, maximumApplicationReadBufferBytes: evidence.maximumApplicationReadBufferBytes, hostedWrites: 0 }));
} finally { await runtime.dispose(); }
