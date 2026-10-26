export type SchemaObject = Readonly<{ name: string; sql: string }>;
export type MigrationDecision = "pending" | "applied" | "stop-and-inspect";

/** 기록과 스키마를 함께 확인하며 부분 적용·응답 불명은 자동 재실행하지 않습니다. */
export function assessMigration(expectedHash: string, recordedHash: string | null, expected: readonly SchemaObject[], observed: readonly SchemaObject[]): MigrationDecision {
  if (expected.length === 0) throw new RangeError("검사할 스키마 객체가 필요합니다.");
  const present: readonly SchemaObject[] = expected.flatMap((item) => observed.filter((row) => row.name === item.name));
  const exact: boolean = present.length === expected.length && expected.every((item) => present.some((row) => row.name === item.name && row.sql === item.sql));
  if (recordedHash === expectedHash && exact) return "applied";
  if (recordedHash === null && present.length === 0) return "pending";
  return "stop-and-inspect";
}
