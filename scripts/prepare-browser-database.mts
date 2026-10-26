import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

type SqlRow = Readonly<{ name?: string; tag?: string; hash?: string; state?: string }>;
type SqlResult = Readonly<{ results: readonly SqlRow[]; success: boolean }>;
type Migration = Readonly<{ tag: string }>;
const cli: string = "./node_modules/wrangler/bin/wrangler.js";
const config: string = "dist/server/wrangler.json";
const persistenceDirectory: string = process.env.ALTER_BROWSER_STATE_DIRECTORY ?? ".wrangler/state";
const metadataTable: string = "__alter_preview_migrations";

/** 항상 --local과 프로젝트 미리보기 경로를 명시하므로 운영 DB에 연결하지 않습니다. */
function execute(arguments_: readonly string[]): readonly SqlRow[] {
  const result = spawnSync(process.execPath, ["--import", "./scripts/sites-env.mjs", cli, "d1", "execute", "DB", "--local", "--config", config, "--persist-to", persistenceDirectory, "--json", ...arguments_], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`로컬 D1 준비 실패: exit=${result.status}, stdout=${result.stdout}, stderr=${result.stderr}`);
  const response: readonly SqlResult[] = JSON.parse(result.stdout) as readonly SqlResult[];
  if (!Array.isArray(response) || response.some((item): boolean => !item.success || !Array.isArray(item.results))) throw new Error("로컬 D1 준비 응답을 확인할 수 없습니다.");
  return response.flatMap((item): readonly SqlRow[] => item.results);
}
function literal(value: string): string { return `'${value.replaceAll("'", "''")}'`; }

/** 적용 완료 해시를 확인하고 중단된 마이그레이션은 자동 재실행하지 않습니다. */
async function prepareBrowserDatabase(): Promise<void> {
  await readFile(config, "utf8").catch((error: unknown): never => { throw new Error("브라우저 검사 전에 npm run build를 실행해 로컬 DB 바인딩 설정을 준비하세요.", { cause: error }); });
  const tables: readonly SqlRow[] = execute(["--command", "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='_cf_METADATA'"]);
  if (!tables.some((row): boolean => row.name === metadataTable)) {
    if (tables.length > 0) throw new Error("로컬 미리보기 DB에 이력 없는 테이블이 있습니다. 기존 적용 상태를 확인한 뒤 마이그레이션 이력을 복구하세요. 기존 DB를 초기화하지 않습니다.");
    execute(["--command", `CREATE TABLE ${metadataTable}(tag TEXT PRIMARY KEY,hash TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('applying','applied')))`]);
  }
  const stored: readonly SqlRow[] = execute(["--command", `SELECT tag,hash,state FROM ${metadataTable} ORDER BY tag`]);
  const journal: Readonly<{ entries: readonly Migration[] }> = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
  const tags: readonly string[] = journal.entries.map((entry): string => entry.tag);
  for (const row of stored) if (!row.tag || !tags.includes(row.tag) || row.state !== "applied") throw new Error(`로컬 마이그레이션 상태 확인 필요: tag=${row.tag}, state=${row.state}. 중단된 적용을 자동 재실행하지 않습니다.`);
  let applied: number = 0;
  for (const migration of journal.entries) {
    if (!/^\d{4}_[a-zA-Z0-9_]+$/.test(migration.tag)) throw new Error("로컬 마이그레이션 이름이 올바르지 않습니다.");
    const file: string = `drizzle/${migration.tag}.sql`;
    const hash: string = createHash("sha256").update(await readFile(file)).digest("hex");
    const previous: SqlRow | undefined = stored.find((row): boolean => row.tag === migration.tag);
    if (previous) {
      if (previous.hash !== hash) throw new Error(`이미 적용된 로컬 마이그레이션 변경 감지: ${migration.tag}`);
      continue;
    }
    execute(["--command", `INSERT INTO ${metadataTable}(tag,hash,state) VALUES(${literal(migration.tag)},${literal(hash)},'applying')`]);
    execute(["--file", file]);
    execute(["--command", `UPDATE ${metadataTable} SET state='applied' WHERE tag=${literal(migration.tag)} AND hash=${literal(hash)} AND state='applying'`]);
    applied += 1;
  }
  console.log(JSON.stringify({ check: "browser-database", environment: "local-only", applied, total: journal.entries.length }));
}
await prepareBrowserDatabase();
