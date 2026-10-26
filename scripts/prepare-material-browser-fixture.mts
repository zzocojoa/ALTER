import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { materialPolicy } from "../lib/materials/policy.ts";
import type { MaterialRuntimeEvidence } from "../lib/materials/policy.ts";

const now: number = Date.now();
const evidence: MaterialRuntimeEvidence = { policyVersion: materialPolicy.version, deploymentId: "local-browser-fixture-not-hosted-proof", checkedAt: now, validUntil: now + 86400000, acceptedBodyBytes: 20971520, maximumBufferedBytes: 65536, workerMemoryLimitBytes: 134217728, contentValidation: { pdf: true, image: true, text: true }, privateRangeReadVerified: true, storageVerification: materialPolicy.storageVerification, r2WriteReadVerified: true, accountRemainingQuota: "unavailable", additionalPaidResources: false };
const encoded: string = JSON.stringify(evidence).replaceAll("'", "''");
const sql: string = `INSERT INTO material_inventory VALUES('local_seedy','${randomUUID()}',1,'${randomUUID()}',0,'${encoded}',0,${now},${evidence.validUntil}) ON CONFLICT(owner_id) DO UPDATE SET version=version+1,last_request_id='${randomUUID()}',evidence=excluded.evidence,checked_at=excluded.checked_at,valid_until=excluded.valid_until WHERE json_extract(material_inventory.evidence,'$.deploymentId')='local-browser-fixture-not-hosted-proof';`;
/** --local의 모의 사용자에만 합성 증거를 넣으며 운영 런타임 증거로 사용하지 않습니다. */
const result = spawnSync(process.execPath, ["--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--local", "--config", "dist/server/wrangler.json", "--persist-to", ".wrangler/state", "--command", sql, "--json"], { encoding: "utf8" });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`로컬 자료 UI 픽스처 준비 실패: ${result.status}, ${result.stderr}`);
console.log(JSON.stringify({ status: "prepared", owner: "local_seedy", evidence: "synthetic-local-only", productionProof: false }));
