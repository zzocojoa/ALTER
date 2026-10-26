import { describe, expect, it } from "vitest";
import { assertArtifact } from "../../scripts/artifact-contract";
import type { ArtifactFile } from "../../scripts/artifact-contract";

const fixture: readonly ArtifactFile[] = [
  { path: ".openai/hosting.json", text: JSON.stringify({ d1: "DB", r2: "BUCKET" }) },
  { path: "server/wrangler.json", text: JSON.stringify({ main: "index.js", compatibility_flags: ["nodejs_compat"], assets: { directory: "../client" }, d1_databases: [{ binding: "DB" }], r2_buckets: [{ binding: "BUCKET" }] }) },
  { path: "server/index.js", text: "export default {};" },
  { path: "server/BUILD_ID", text: "fixture" },
  { path: "client/main.js", text: "console.log('fixture');" },
  { path: ".openai/drizzle/meta/_journal.json", text: JSON.stringify({ entries: [] }) },
];

describe("Workers 운영 산출물", () => {
  it("빈 마이그레이션 저널을 허용하고 입력은 보존한다", () => {
    const frozen = Object.freeze(fixture.map((file) => Object.freeze({ ...file })));
    expect(() => assertArtifact(frozen)).not.toThrow();
    expect(frozen).toEqual(fixture);
  });
  it.each(["server/index.js", ".openai/hosting.json", ".openai/drizzle/meta/_journal.json", "client/main.js"])("필수 파일 누락을 차단한다: %s", (path) => {
    expect(() => assertArtifact(fixture.filter((file) => file.path !== path))).toThrow();
  });
  it.each(["__sites_local_auth", "ALTER_TEST_SECRET_DO_NOT_SHIP", "-----BEGIN PRIVATE KEY-----", 'import child from "node:child_process";'])("개발 코드·비밀값·금지 모듈을 차단한다: %s", (text) => {
    expect(() => assertArtifact([...fixture, { path: "server/leak.js", text }])).toThrow();
  });
  it("네이티브 바이너리와 잘못된 바인딩을 차단한다", () => {
    expect(() => assertArtifact([...fixture, { path: "server/addon.node", text: "binary" }])).toThrow(/금지 파일/);
    expect(() => assertArtifact(fixture.map((file) => file.path === ".openai/hosting.json" ? { ...file, text: '{"d1":"WRONG","r2":"BUCKET"}' } : file))).toThrow();
  });
  it("저널에 기록된 SQL의 누락을 차단한다", () => {
    expect(() => assertArtifact(fixture.map((file) => file.path.endsWith("_journal.json") ? { ...file, text: '{"entries":[{"tag":"0001_future"}]}' } : file))).toThrow(/0001_future.sql/);
  });
});
