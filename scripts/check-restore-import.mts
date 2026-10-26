import { checkRestoreImport } from "./restore-import-check.mts";

await checkRestoreImport((): string => "restored-worker-owner", ".taskmaster/reports/task-17-restore-import-local.json");
await checkRestoreImport((sourceOwner: string): string => sourceOwner, ".taskmaster/reports/task-17-restore-same-owner-local.json");
