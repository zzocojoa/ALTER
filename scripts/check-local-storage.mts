import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";

/** 운영 자격 증명 없이 매 호출마다 새 메모리 저장소를 만듭니다. */
function createLocalRuntime(): Miniflare {
  return new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('local-storage-test'); } }",
    compatibilityDate: "2026-05-15",
    d1Databases: ["DB"], r2Buckets: ["BUCKET"],
    d1Persist: false, r2Persist: false, cf: false,
  });
}

/** D1의 0행 갱신·결과 불명 및 R2 격리 동작을 실제 로컬 workerd로 확인합니다. */
async function checkLocalStorage(): Promise<void> {
  const runtime: Miniflare = createLocalRuntime();
  const isolated: Miniflare = createLocalRuntime();
  try {
    const db = await runtime.getD1Database("DB");
    const bucket = await runtime.getR2Bucket("BUCKET");
    const migration: string = await readFile("drizzle/0000_mixed_hannibal_king.sql", "utf8");
    await db.prepare(migration).run();
    const candidateSql: string = "INSERT INTO owner_enrollment (slot, user_id, requested_at) VALUES (1, ?, ?) ON CONFLICT(slot) DO UPDATE SET requested_at = excluded.requested_at WHERE owner_enrollment.user_id = excluded.user_id RETURNING slot";
    assert.deepEqual(await db.prepare(candidateSql).bind("candidate-A", 1).first(), { slot: 1 });
    assert.equal(await db.prepare(candidateSql).bind("candidate-B", 2).first(), null);
    assert.equal(await db.prepare("SELECT user_id FROM owner_enrollment WHERE slot = 1").first<string>("user_id"), "candidate-A");
    await db.prepare("DELETE FROM owner_enrollment WHERE slot = 1").run();
    await db.prepare("CREATE TABLE fixture (id TEXT PRIMARY KEY, lease_until INTEGER, external_state TEXT)").run();
    const results = await db.batch([
      db.prepare("UPDATE fixture SET external_state = 'confirmed' WHERE id = 'missing'"),
      db.prepare("INSERT INTO fixture VALUES ('unknown-result', 0, 'unknown')"),
    ]);
    assert.equal(results[0].success, true);
    assert.equal(results[0].meta.changes, 0);
    assert.equal(results[1].meta.changes, 1);
    const pending = await db.prepare("SELECT external_state FROM fixture WHERE lease_until < ?").bind(1).first<{ external_state: string }>();
    assert.deepEqual(pending, { external_state: "unknown" });
    await assert.rejects(db.prepare("INSERT INTO missing_table VALUES ('failure')").run(), /no such table/);
    await bucket.put("fixture.txt", "격리된 로컬 자료");
    const object = await bucket.get("fixture.txt");
    assert(object);
    assert.equal(await object.text(), "격리된 로컬 자료");
    await assert.rejects(runtime.getD1Database("MISSING"), /MISSING/);
    await assert.rejects(runtime.getR2Bucket("MISSING"), /MISSING/);
    const otherDb = await isolated.getD1Database("DB");
    const otherBucket = await isolated.getR2Bucket("BUCKET");
    assert.equal(await otherDb.prepare("SELECT name FROM sqlite_master WHERE name = 'fixture'").first(), null);
    assert.equal(await otherBucket.get("fixture.txt"), null);
    await db.prepare("DELETE FROM fixture").run();
    await bucket.delete("fixture.txt");
    assert.equal(await db.prepare("SELECT count(*) AS count FROM fixture").first<number>("count"), 0);
    assert.equal(await bucket.get("fixture.txt"), null);
    console.log(JSON.stringify({ check: "local-storage", status: "passed", runtime: "Miniflare/workerd", checks: ["d1-roundtrip", "r2-roundtrip", "missing-bindings", "sql-failure", "zero-row-batch", "expired-lease-unknown-result", "isolation", "cleanup", "enrollment-migration", "candidate-conflict-no-overwrite"] }));
  } finally {
    await Promise.all([runtime.dispose(), isolated.dispose()]);
  }
}

await checkLocalStorage();
