import { verifyMaterialInventory } from "../../lib/materials/inventory.ts";
import { getMaterialUsage } from "../../db/repositories/material-transfers.ts";
import { startMaterialTransfer } from "../../lib/materials/start.ts";
import { createCourse } from "../../db/repositories/courses.ts";
import { recordId } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";

type Bindings = Readonly<{ DB: D1Database; BUCKET: R2Bucket }>;
function check(value: boolean, name: string): void { if (!value) throw new Error(`저장소 대사 검사 실패: ${name}`); }
async function rejects(action: () => Promise<unknown>, field: string): Promise<void> {
  try { await action(); } catch (error: unknown) { if (error instanceof Error && error.message.includes(field)) return; throw error; }
  throw new Error(`저장소 대사 거부 누락: ${field}`);
}
function bucketWith(bucket: R2Bucket, overrides: Partial<R2Bucket>): R2Bucket { return new Proxy(bucket, { get(target, property) { const value: unknown = Reflect.get(overrides, property) ?? Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value; } }); }
const worker = {
  async fetch(_request: Request, env: Bindings): Promise<Response> {
    const owner: SiteIdentity = { realm: "sites", userId: `inventory-test-${crypto.randomUUID()}` };
    const now: number = Date.now();
    const original = await verifyMaterialInventory(env.DB, env.BUCKET, owner, now);
    check(original.usage.untrackedBytes === 1029 && !original.usage.blocked, "orphan-plus-fixed-probe-reservation");
    check((await env.BUCKET.list()).objects.length === 1, "probe-cleaned-unrelated-preserved");
    const repeated = await verifyMaterialInventory(env.DB, env.BUCKET, owner, now + 1);
    check(repeated.usage.untrackedBytes === 1029, "no-double-count-on-refresh");
    let putCalls: number = 0;
    const failed: R2Bucket = bucketWith(env.BUCKET, { async put(): Promise<never> { putCalls += 1; throw new Error("injected-quota-error"); } });
    await rejects(() => verifyMaterialInventory(env.DB, failed, owner, now + 2), "injected-quota-error");
    check(putCalls === 3 && (await getMaterialUsage(env.DB, owner)).blocked, "failure-blocks-registration");
    await verifyMaterialInventory(env.DB, env.BUCKET, owner, now + 3);
    check(!(await getMaterialUsage(env.DB, owner)).blocked, "failed-audit-retry");
    const listFailure: R2Bucket = bucketWith(env.BUCKET, { async list(): Promise<never> { throw new Error("injected-list-failure"); } });
    await rejects(() => verifyMaterialInventory(env.DB, listFailure, owner, now + 4), "material.inventory.list");
    check((await getMaterialUsage(env.DB, owner)).blocked, "unknown-inventory-blocks");
    const oversized: R2Bucket = bucketWith(env.BUCKET, { async list(): Promise<R2Objects> { const list: R2Objects = await env.BUCKET.list(); return { ...list, objects: list.objects.map((item): R2Object => ({ ...item, size: 268435456, writeHttpMetadata: item.writeHttpMetadata.bind(item) })) }; } });
    await rejects(() => verifyMaterialInventory(env.DB, oversized, owner, now + 5), "application-capacity");
    check((await getMaterialUsage(env.DB, owner)).blocked, "capacity-includes-probe-budget");
    await verifyMaterialInventory(env.DB, env.BUCKET, owner, now + 6);
    let release: (() => void) | undefined;
    const hold = new Promise<void>((resolve): void => { release = resolve; });
    let reached: (() => void) | undefined;
    const started = new Promise<void>((resolve): void => { reached = resolve; });
    const delayed: R2Bucket = bucketWith(env.BUCKET, { async list(): Promise<R2Objects> { reached?.(); await hold; return env.BUCKET.list(); } });
    const old = verifyMaterialInventory(env.DB, delayed, owner, now + 7);
    await started;
    await verifyMaterialInventory(env.DB, env.BUCKET, owner, now + 8);
    release?.();
    await rejects(() => old, "inventory-superseded");
    check(!(await getMaterialUsage(env.DB, owner)).blocked, "old-audit-cannot-overwrite-current");
    const courseId = recordId.parse(crypto.randomUUID());
    await createCourse(env.DB, { owner, requestKey: crypto.randomUUID(), expectedVersion: 1 }, { id: courseId, title: "저장소 검증 과정" });
    const metadata = { title: "예약", edition: "", role: "reference" as const, kind: "text" as const, filename: "a.txt", mime: "text/plain" as const, bytes: 16, sha256: "a".repeat(64) };
    await startMaterialTransfer(env.DB, owner, crypto.randomUUID(), { courseId, metadata }, now + 9);
    await rejects(() => verifyMaterialInventory(env.DB, env.BUCKET, owner, now + 10), "finish-or-cleanup-current-transfer");
    const usage = await getMaterialUsage(env.DB, owner);
    check(usage.reservedBytes === 16 && usage.activeTransfers === 1, "active-reservation-preserved");
    return Response.json({ status: "passed", tests: 13, actualR2: true, faultInjection: true });
  },
};

export default worker;
