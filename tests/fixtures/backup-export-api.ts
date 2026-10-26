import { readFile } from "node:fs/promises";
import path from "node:path";
import { writeBackupFixture, preflightFixtureRows, originalEntry } from "./backup-files";
import type { BackupManifest } from "../../lib/backup/contracts";
export type BackupExportFixture = Readonly<{ manifest: BackupManifest; requests: string[]; state: { exists: boolean; completed: boolean; damagedPath: string | null }; respond: (url: string, method: string) => Promise<Response> }>;
/** 실제 제공자 호출 없이 내보내기 HTTP 계약과 실패 응답을 재현합니다. */
export async function backupExportFixture(root: string): Promise<BackupExportFixture> {
  const manifest = await writeBackupFixture(root, preflightFixtureRows(), [originalEntry]);
  const requests: string[] = []; const state = { exists: true, completed: false, damagedPath: null as string | null };
  async function respond(url: string, method: string): Promise<Response> {
    const parsed = new URL(url, "https://backup.local.test"); const location: string = parsed.pathname; requests.push(`${method} ${location}`);
    const base: string = `/api/backup/${manifest.backupId}`;
    const run = (): Response => Response.json({ id: manifest.backupId, basis: manifest.basis, state: state.completed ? "complete" : "exporting", current: true });
    if (location === "/api/backup" && method === "POST") { state.exists = true; return run(); }
    if (location === base && method === "GET") return state.exists ? run() : Response.json({ error: "missing-export" }, { status: 404 });
    if (location === `${base}/complete`) { state.completed = true; return Response.json(manifest); }
    if (location === `${base}/database` || location.endsWith("/received")) return Response.json({ received: true });
    if (location === `${base}/objects`) return Response.json({ entries: manifest.objects, count: manifest.objects.length, nextOffset: null });
    const page = manifest.pages.find(item => location === `${base}/pages/${item.table}/${item.ordinal}`);
    const object = manifest.objects.find((_item, ordinal) => location === `${base}/objects/${ordinal}`); const entry = page ?? object;
    if (!entry) throw new Error(`검증에 정의하지 않은 백업 경로: ${method} ${location}`);
    const data = await readFile(path.join(root, entry.path)); const body = state.damagedPath === entry.path ? Buffer.alloc(data.length) : data;
    return new Response(body, { headers: { "content-type": page ? "application/json" : "application/octet-stream", "x-backup-bytes": String(entry.bytes), "x-backup-sha256": entry.sha256 } });
  }
  return { manifest, requests, state, respond };
}
