import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { Hash } from "node:crypto";
import path from "node:path";
import { build } from "vite";
import { Miniflare } from "miniflare";
import { materialPolicy } from "../lib/materials/policy.ts";
import type { MaterialResourceProbe } from "../lib/materials/resource-probe.ts";

const output: string = path.resolve(".sites-runtime/material-resource-check");
await build({ configFile: false, logLevel: "warn", ssr: { noExternal: true, external: ["node:crypto"], target: "webworker" }, build: { ssr: "tests/fixtures/material-resource-worker.ts", target: "es2022", outDir: output, emptyOutDir: true, rollupOptions: { output: { entryFileNames: "worker.mjs" } } } });
const runtime: Miniflare = new Miniflare({ modules: true, scriptPath: path.join(output, "worker.mjs"), compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"], r2Buckets: ["BUCKET"], cf: false });
async function* body(bytes: number): AsyncGenerator<Uint8Array> {
  for (let offset: number = 0; offset < bytes; offset += 65536) yield new Uint8Array(Math.min(65536, bytes - offset));
}
function checksum(bytes: number): string {
  const digest: Hash = createHash("sha256");
  for (let offset: number = 0; offset < bytes; offset += 65536) digest.update(new Uint8Array(Math.min(65536, bytes - offset)));
  return digest.digest("hex");
}
try {
  const bucket = await runtime.getR2Bucket("BUCKET");
  await bucket.put("preserved-owner-file", "owner");
  for (const kind of ["text", "image", "pdf"] as const) {
    for (const delta of [-1, 0, 1]) {
      const bytes: number = materialPolicy.types[kind].maximumBytes + delta;
      const extension: string = kind === "text" ? "txt" : kind === "image" ? "png" : "pdf";
      const mime: string = kind === "text" ? "text/plain" : kind === "image" ? "image/png" : "application/pdf";
      // 초과 크기는 본문 전송 전에 거절되어야 하며 실제 스트림 초과는 별도 검사합니다.
      console.log(JSON.stringify({ event: "material_resource_boundary_start", kind, bytes, delta }));
      const response = await runtime.dispatchFetch("https://local.invalid/resource", { method: "POST", body: delta === 1 ? new Uint8Array(0) : body(bytes), duplex: "half", headers: { "x-probe-kind": kind, "x-probe-filename": `probe.${extension}`, "x-probe-mime": mime, "x-probe-bytes": String(bytes), "x-probe-sha256": checksum(bytes) } });
      const result: unknown = await response.json();
      assert.equal(response.status, delta === 1 ? 413 : 200, JSON.stringify(result));
      if (delta !== 1) {
        const proof: MaterialResourceProbe = result as MaterialResourceProbe;
        assert.equal(proof.upload.bytes, bytes); assert.equal(proof.download.bytes, bytes);
        assert.equal(proof.objectBytes, bytes); assert.equal(proof.rangeBytes, 32);
        assert.equal(proof.cleanup, "passed"); assert.equal(proof.storedBytesBeforeProbe, 5);
        assert.equal(proof.accountQuotaVerified, false); assert.equal(proof.contentValidated, false);
        assert.ok(proof.upload.maximumReadBufferBytes <= 65536); assert.ok(proof.download.maximumReadBufferBytes <= 65536);
      }
      assert.deepEqual((await bucket.list()).objects.map((object) => object.key), ["preserved-owner-file"]);
    }
  }
  console.log(JSON.stringify({ tests: 9, status: "passed", runtime: "local-workerd", unrelatedObjectPreserved: true }));
} finally { await runtime.dispose(); }
