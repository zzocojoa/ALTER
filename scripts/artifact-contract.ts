import { z } from "zod";

export type ArtifactFile = Readonly<{ path: string; text: string }>;

const hostingSchema = z.object({ d1: z.literal("DB"), r2: z.literal("BUCKET") });
const workerSchema = z.object({
  main: z.literal("index.js"),
  compatibility_flags: z.array(z.string()),
  assets: z.object({ directory: z.literal("../client") }),
  d1_databases: z.array(z.object({ binding: z.literal("DB") })).length(1),
  r2_buckets: z.array(z.object({ binding: z.literal("BUCKET") })).length(1),
  services: z.array(z.unknown()).optional(),
});
const journalSchema = z.object({ entries: z.array(z.object({ tag: z.string().regex(/^[\w-]+$/) })) });

function requiredFile(files: readonly ArtifactFile[], path: string): ArtifactFile {
  const file: ArtifactFile | undefined = files.find((entry) => entry.path === path);
  if (!file) throw new TypeError(`필수 산출물 누락: ${path}`);
  return file;
}

/** 빌드 산출물의 구조와 개발 전용 코드·알려진 비밀값 패턴을 검사합니다. */
export function assertArtifact(files: readonly ArtifactFile[]): void {
  hostingSchema.parse(JSON.parse(requiredFile(files, ".openai/hosting.json").text));
  const worker = workerSchema.parse(JSON.parse(requiredFile(files, "server/wrangler.json").text));
  if (!worker.compatibility_flags.includes("nodejs_compat")) throw new TypeError("Workers nodejs_compat 설정이 누락됐습니다.");
  if (worker.services?.length) throw new TypeError("운영 산출물에 로컬 서비스 바인딩이 포함됐습니다.");
  requiredFile(files, "server/index.js");
  requiredFile(files, "server/BUILD_ID");
  if (!files.some((file) => file.path.startsWith("client/") && file.path.endsWith(".js"))) throw new TypeError("클라이언트 JavaScript 산출물이 없습니다.");
  const journal = journalSchema.parse(JSON.parse(requiredFile(files, ".openai/drizzle/meta/_journal.json").text));
  for (const migration of journal.entries) requiredFile(files, `.openai/drizzle/${migration.tag}.sql`);
  for (const file of files) {
    if (/(^|\/)(tests?|node_modules|\.env[^/]*|\.dev\.vars[^/]*)(\/|$)|\.(node|pem)$/.test(file.path)) throw new TypeError(`운영 패키지 금지 파일: ${file.path}`);
    if (/__sites_local_auth|seedy@sites\.test|local_seedy|sites-connector-preview|ALTER_TEST_SECRET_DO_NOT_SHIP/.test(file.text)) throw new TypeError(`로컬 인증·테스트 표식 유입: ${file.path}`);
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|sk-proj-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35}/.test(file.text)) throw new TypeError(`비밀값 패턴 발견: ${file.path}`);
    if (/(?:from\s*|import\s*\(|require\s*\()["'`]node:(?:child_process|cluster|inspector)["'`]/.test(file.text)) throw new TypeError(`Workers에서 실행할 수 없는 프로세스 모듈: ${file.path}`);
  }
}
