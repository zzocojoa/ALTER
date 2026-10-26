import { backupCatalog } from "./catalog.ts";
import type { BackupTableName } from "./catalog.ts";
import { backupFailure } from "./contracts.ts";
import type { BackupManifest } from "./contracts.ts";

/** 외래 키 외에도 정적 참조 검사에 필요한 부모를 먼저 적재합니다. 상호 배제 검사는 순서 의존성이 아닙니다. */
const staticParents: Readonly<Partial<Record<BackupTableName, readonly BackupTableName[]>>> = {"answer_files": ["attempts", "material_transfers", "materials", "sessions"], "attempts": ["sessions"], "confirmed_results": ["corrections", "errors"], "corrections": ["librarian_link_sources", "librarian_links", "materials", "units"], "errors": ["attempts", "sessions"], "material_files": ["uploads"], "review_schedule": ["errors", "learning_results", "sessions"], "tutor_help_details": ["attempts"], "tutor_variations": ["attempts", "help_events"], "weekly_evidence": ["learning_results", "units", "weekly_summaries"]};
export function restoreTableOrder(): readonly BackupTableName[] {
  const ordered: BackupTableName[] = [];
  while (ordered.length < backupCatalog.length) {
    const ready = backupCatalog.filter(table => !ordered.includes(table.name) && [...table.references.map(reference => reference.table), ...(staticParents[table.name] ?? [])].every(parent => parent === table.name || ordered.includes(parent as BackupTableName)));
    if (ready.length === 0) throw backupFailure("invalid-page", "restore.table-dependency-cycle");
    ordered.push(...ready.map(table => table.name));
  }
  return ordered;
}
export function restorePageOrder(manifest: BackupManifest): BackupManifest["pages"] {
  return restoreTableOrder().flatMap(table => manifest.pages.filter(page => page.table === table).toSorted((a, b) => a.ordinal - b.ordinal));
}
