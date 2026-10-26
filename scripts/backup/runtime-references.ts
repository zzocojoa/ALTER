import type { BackupRow } from "../../lib/backup/contracts.ts";
import { runtimeReferences as savedRuntimeReferences } from "../../lib/backup/runtime-references.ts";
import { preflightFailure } from "./failure.ts";

/** 로컬 사전 검사와 서버 복원 검증은 같은 저장 상태·참조 계약을 사용합니다. */
export function runtimeReferences(table: string, row: BackupRow, location: string): ReturnType<typeof savedRuntimeReferences> {
  try { return savedRuntimeReferences(table, row, location); }
  catch (error: unknown) { if (error instanceof Error && error.name === "BackupFailure") throw preflightFailure("state-identity", location, "matching saved learning identity", "mismatch"); throw error; }
}
