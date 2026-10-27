import { expect, it } from "vitest";
import { aiRequestIssues } from "../../lib/ui/ai-availability";
import { publicAiSupport } from "../../lib/dashboard/ai-support";
import { aiCapability, aiSupportContract } from "../../lib/ai/support";
import type { AiCapability } from "../../lib/ai/support";
import type { AiConfiguration } from "../../lib/ai/configuration";
import { fixtureTutorBudget } from "../fixtures/tutor-budget";
import { fixtureFunding, fixturePrepaidProbe } from "../fixtures/ai-funding";
import { fixturePricing } from "../fixtures/ai-pricing";

const now: number = 500_000;
const required: readonly AiCapability[] = ["text", "image", "structured-output", "usage", "output-limit"];

it("원장·지원 미확인과 복수 차단 사유를 정상 상태로 추정하지 않는다", (): void => {
  const data = fixtureTutorBudget(now);
  expect(aiRequestIssues(null, required, now)).toHaveLength(1);
  expect(aiRequestIssues(data, required, now)).toEqual([]);
  const blocked = { ...data, ai: { ...data.ai, configuration: "missing" as const, funding: null, pricing: null, support: [] } };
  expect(aiRequestIssues(blocked, required, now)).toHaveLength(8);
  expect(aiRequestIssues(data, required, now + 300_000).join(" ")).toContain("오래됐어요");
});
it("누적 상한·지원 거부·만료를 함께 표시하며 사진 지원은 사진을 보낼 때 요구한다", (): void => {
  const data = fixtureTutorBudget(now);
  const blocked = { ...data, ai: { ...data.ai, probeCommittedUsdMicros: 50_000, support: data.ai.support.map((item) => item.capability === "image" ? { ...item, state: "denied" as const } : { ...item, validUntil: now }) } };
  const issues: string = aiRequestIssues(blocked, required, now).join(" ");
  expect(issues).toContain("누적 검증 상한"); expect(issues).toContain("사진 판독 기능은 현재 계정에서 지원 거부"); expect(issues).toContain("텍스트 지원 확인이 만료");
  const textOnly = { ...data, ai: { ...data.ai, support: data.ai.support.filter((item) => item.capability !== "image") } };
  expect(aiRequestIssues(textOnly, ["text", "structured-output", "usage", "output-limit"], now)).toEqual([]);
});
it("지원 상태 공개는 같은 계정의 실제 환경 관측만 사용하고 비밀 식별자를 제외한다", (): void => {
  const base = fixturePrepaidProbe(fixtureFunding("fixture-owner", fixturePricing().id, now), fixturePricing());
  const configuration: AiConfiguration = { ...base, support: aiCapability.options.map((capability) => ({ capability, model: aiSupportContract.model, sdkVersion: aiSupportContract.sdkVersion, accountFingerprint: base.funding.accountFingerprint, environment: "hosted-worker", result: "supported", responseId: "fixture-response", checkedAt: now - 1, validUntil: now + 1000 })) };
  const before: string = JSON.stringify(configuration);
  const visible = publicAiSupport(configuration, now);
  expect(visible.every((item) => item.state === "verified")).toBe(true);
  expect(JSON.stringify(visible)).not.toContain(base.funding.accountFingerprint); expect(JSON.stringify(visible)).not.toContain("fixture-response");
  expect(publicAiSupport({ ...configuration, support: configuration.support.map((item) => ({ ...item, environment: "local-mock" })) }, now).every((item) => item.state === "unverified")).toBe(true);
  expect(publicAiSupport(configuration, now + 1000).every((item) => item.state === "unverified")).toBe(true);
  expect(JSON.stringify(configuration)).toBe(before);
});
