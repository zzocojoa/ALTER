import { expect, test } from "vitest";
import { assessMigration } from "@/lib/domain/migrations";

const schema = [{ name: "a", sql: "CREATE TABLE a(id TEXT)" }, { name: "b", sql: "CREATE TABLE b(id TEXT)" }] as const;
test("스키마와 적용 기록이 일치할 때만 완료로 판정한다", () => {
  expect(assessMigration("hash", "hash", schema, schema)).toBe("applied");
  expect(assessMigration("hash", null, schema, [])).toBe("pending");
});
test("중단·변조·기록 유실·응답 불명은 자동 재실행하지 않는다", () => {
  expect(assessMigration("hash", null, schema, schema.slice(0, 1))).toBe("stop-and-inspect");
  expect(assessMigration("hash", null, schema, schema)).toBe("stop-and-inspect");
  expect(assessMigration("hash", "changed", schema, schema)).toBe("stop-and-inspect");
  expect(assessMigration("hash", "hash", schema, [{ name: "a", sql: "ALTERED" }])).toBe("stop-and-inspect");
});
