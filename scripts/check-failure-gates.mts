import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { unlink, writeFile } from "node:fs/promises";

type FailureCase = Readonly<{ name: string; file: string; source: string; script: string; args: readonly string[]; timeoutMs: number; diagnostic: RegExp }>;

/** 의도적인 결함마다 실제 검사 명령의 종료 코드와 오류 원인을 확인하고 파일을 정리합니다. */
async function checkFailure(testCase: FailureCase): Promise<void> {
  await writeFile(testCase.file, testCase.source, { flag: "wx" });
  try {
    const result = spawnSync("npm", ["run", testCase.script, "--", ...testCase.args], { encoding: "utf8", timeout: testCase.timeoutMs });
    if (result.error) throw result.error;
    assert(result.status !== null && result.status !== 0, `${testCase.name}: 실패를 정상 종료로 처리했습니다.`);
    assert.match(result.stdout + result.stderr, testCase.diagnostic, `${testCase.name}: 예상한 결함과 다른 원인으로 실패했습니다.`);
    console.log(JSON.stringify({ check: testCase.name, status: "expected-failure-confirmed", exitCode: result.status }));
  } finally {
    await unlink(testCase.file);
  }
}

// 브라우저 검사는 매번 전체 마이그레이션을 새 격리 DB에 적용한 뒤 실제 실패를 확인합니다.
const cases: readonly FailureCase[] = [
  { name: "type-error", file: "app/__expected-type-failure.ts", source: 'export const broken: number = "wrong";', script: "typecheck", args: [], timeoutMs: 90_000, diagnostic: /TS2322/ },
  { name: "lint-error", file: "app/__expected-lint-failure.ts", source: "export const broken: any = 1;", script: "lint", args: [], timeoutMs: 90_000, diagnostic: /no-explicit-any/ },
  { name: "unit-failure", file: "tests/unit/expected-failure.test.ts", source: 'import { it, expect } from "vitest"; it("의도적인 실패", () => expect(1).toBe(2));', script: "test:unit", args: ["tests/unit/expected-failure.test.ts"], timeoutMs: 90_000, diagnostic: /expected 1 to be 2/ },
  { name: "browser-failure", file: "tests/e2e/expected-failure.spec.ts", source: 'import { test, expect } from "@playwright/test"; test("의도적인 실패", async ({ page }) => { await page.goto("/"); await expect(page.getByRole("heading", {level: 1})).toHaveText("의도적인 실패 표식", { timeout: 1000 }); });', script: "test:e2e", args: ["--project=desktop-chromium", "expected-failure.spec.ts"], timeoutMs: 300_000, diagnostic: /의도적인 실패 표식/ },
];

for (const testCase of cases) await checkFailure(testCase);
