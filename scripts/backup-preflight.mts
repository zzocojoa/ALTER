import { preflightBackup, isPreflightFailure } from "./backup/preflight.ts";

/** 실행 예시: npm run backup:preflight -- /absolute/path/to/backup-directory */
const directory: string | undefined = process.argv[2];
if (!directory || process.argv.length !== 3) throw new Error("백업 폴더 한 개를 지정하세요: npm run backup:preflight -- /absolute/path/to/backup-directory");
try { console.log(JSON.stringify(await preflightBackup(directory), null, 2)); }
catch (error: unknown) {
  if (!isPreflightFailure(error)) throw error;
  console.error(JSON.stringify({ status: "rejected", ...error.issue, targetWrites: 0, providerCalls: 0 })); process.exitCode = 1;
}
