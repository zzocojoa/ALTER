import { describe, expect, it } from "vitest";
import { aiSupportContract, requireAiSupport, supportObservation } from "../../lib/ai/support";
import type { SupportObservation } from "../../lib/ai/support";
import { runSdkProbe } from "../fixtures/ai-sdk-probe";

const account: string = "a".repeat(64);
const supported: SupportObservation = supportObservation.parse({ capability: "image", model: "gpt-6-luna", sdkVersion: "7.43.0", accountFingerprint: account, environment: "hosted-worker", result: "supported", responseId: "resp_test", checkedAt: 100, validUntil: 200 });

describe("지정 모델 지원 증거", (): void => {
  it("미확인·모의·다른 계정·만료·미래 증거는 실제 지원으로 통과시키지 않는다", (): void => {
    for (const evidence of [[], [{ ...supported, environment: "local-mock" as const }], [{ ...supported, accountFingerprint: "b".repeat(64) }], [{ ...supported, responseId: null }], [{ ...supported, checkedAt: 151 }], [{ ...supported, validUntil: 150 }]]) {
      expect(() => requireAiSupport(evidence, ["image"], account, 150)).toThrow(expect.objectContaining({ code: "ai_support_unverified", capability: "image" }));
    }
  });
  it("최신 접근 거부를 과거 성공으로 덮지 않는다", (): void => {
    expect(() => requireAiSupport([supported, { ...supported, checkedAt: 110, result: "unsupported" }], ["image"], account, 150)).toThrow(expect.objectContaining({ code: "ai_support_denied" }));
    expect(() => requireAiSupport([supported], ["image"], account, 150)).not.toThrow();
    expect(() => requireAiSupport([supported], ["text"], account, 150)).toThrow();
  });
  it("잘못된 모델·SDK·추가 필드를 거부한다", (): void => {
    for (const value of [{ ...supported, model: "other" }, { ...supported, sdkVersion: "other" }, { ...supported, secret: "not-allowed" }]) expect(supportObservation.safeParse(value).success).toBe(false);
    expect(aiSupportContract.browserAccess).toBe(false);
    expect(aiSupportContract.modelTools).toEqual([]);
  });
  it("설치된 공식 SDK의 구조화·이미지·스트림·파싱 실패 usage와 재시도 비활성을 검사한다", async (): Promise<void> => {
    expect(await runSdkProbe()).toEqual({ environment: "mock", model: "gpt-6-luna", strictFormat: true, image: true, responseId: "resp_fixture", usageBeforeParseFailure: 16, parseRejected: true, streamEvents: 1, sdkRetries: 0, https: true });
  });
});
