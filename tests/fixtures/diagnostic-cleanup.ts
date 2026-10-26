import assert from "node:assert/strict";

/** 정리 구현의 목록과 독립적으로 모든 소유자 테이블에서 검사 잔여 행을 찾습니다. */
export async function assertNoVerificationRecords(db: D1Database): Promise<void> {
  const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND lower(substr(name,1,4)) <> '_cf_'").all<{ name: string }>();
  for (const table of tables.results) {
    assert.match(table.name, /^[a-z_][a-z0-9_]*$/i);
    const columns = await db.prepare(`PRAGMA table_info("${table.name}")`).all<{ name: string }>();
    if (columns.results.some(column => column.name === "owner_id")) {
      const count: number | null = await db.prepare(`SELECT count(*) AS n FROM "${table.name}" WHERE owner_id LIKE 'verification:%'`).first<number>("n");
      assert.equal(count, 0, `검사 잔여 행: ${table.name}`);
    }
  }
}
