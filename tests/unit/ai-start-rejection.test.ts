import { expect, it } from "vitest";
import { matchesAiStartRejection } from "../../lib/tutor/ai-start-rejection";

const intent = { key: "00000000-0000-4000-a000-000000000001", input: { id: "00000000-0000-4000-a000-000000000002", expectedVersion: 3, action: "diagnose" } };
const proof = { status: "not-started", key: intent.key, ...intent.input };

it("시작 전 거부는 같은 요청 키·회차·버전·동작에만 적용한다", (): void => {
  expect(matchesAiStartRejection(proof, intent)).toBe(true);
  for (const change of [{ key: crypto.randomUUID() }, { id: crypto.randomUUID() }, { expectedVersion: 4 }, { action: "help" }, { status: "unknown" }]) {
    expect(matchesAiStartRejection({ ...proof, ...change }, intent)).toBe(false);
  }
});
it("4xx·영수증 부재·불완전 응답을 시작 전 확정 거부로 추정하지 않는다", (): void => {
  for (const value of [undefined, null, { error: "version_conflict" }, { status: "unobserved" }, { ...proof, key: undefined }, { ...proof, extra: true }]) expect(matchesAiStartRejection(value, intent)).toBe(false);
});
