import { describe, expect, it } from "vitest";
import { canonicalJson, contentHash, encryptedToken, googleIdentity, money, parseKrw, performance, policy, progress, scope, seoulStudyDate, siteIdentity, studyDate, submittedAnswer } from "@/lib/domain/contracts";

describe("학습 도메인 입력 계약", () => {
  it("Sites 신원과 Google 신원을 분리한다", () => {
    expect(siteIdentity.safeParse({ realm: "google", subject: "same-email" }).success).toBe(false);
    expect(googleIdentity.safeParse({ realm: "sites", userId: "same-email" }).success).toBe(false);
  });
  it("진도와 수행 성과를 혼용하지 않는다", () => {
    expect(progress.parse("완료")).toBe("완료");
    expect(performance.safeParse("완료").success).toBe(false);
    expect(progress.safeParse("독립 수행").success).toBe(false);
    expect(submittedAnswer.safeParse({ kind: "draft", text: "답", expectedVersion: 1 }).success).toBe(false);
  });
  it("소수 금액을 손실 없이 저장하고 범위 초과와 부동 소수 입력을 거부한다", () => {
    expect(parseKrw("0.000001").units).toBe(1);
    expect(parseKrw("7000").units).toBe(7_000_000_000);
    for (const value of ["-1", "1.1234567", "9007199254.740992", "NaN"]) expect(() => parseKrw(value)).toThrow();
    expect(money.safeParse({ currency: "KRW", units: 0.1, scale: 1_000_000 }).success).toBe(false);
  });
  it("날짜와 모델·권한·무료 정책을 고정한다", () => {
    expect(seoulStudyDate(Date.parse("2026-10-23T15:00:00Z"))).toBe("2026-10-24");
    expect(studyDate.safeParse("2026-02-30").success).toBe(false);
    expect(policy.model).toBe("gpt-6-luna");
    expect(policy.existingSubscriptionIncluded).toBe(false);
    expect(scope.safeParse("https://www.googleapis.com/auth/drive").success).toBe(false);
  });
  it("토큰 평문 필드와 미완성 암호화 봉투를 거부한다", () => {
    expect(encryptedToken.safeParse({ refreshToken: "plain-secret" }).success).toBe(false);
    expect(encryptedToken.safeParse({ algorithm: "AES-GCM", ciphertext: "not-encrypted", nonce: "short", keyVersion: "v1" }).success).toBe(false);
  });
  it("필드 순서가 달라도 같은 요청 해시이며 내용이 다르면 다르다", async () => {
    expect(await contentHash({ b: 2, a: 1 })).toBe(await contentHash({ a: 1, b: 2 }));
    expect(await contentHash({ a: 2 })).not.toBe(await contentHash({ a: 1 }));
    expect(() => canonicalJson({ a: undefined })).toThrow();
  });
});
