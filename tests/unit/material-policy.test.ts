import { describe, expect, it } from "vitest";
import { materialPolicy, requireMaterialBodyLength, requireMaterialRuntime, requireMaterialStorage, validateMaterialMetadata } from "../../lib/materials/policy";
import type { MaterialMetadata } from "../../lib/materials/policy";

const pdf: MaterialMetadata = { title: "전공 교재", edition: "3판", role: "textbook", kind: "pdf", filename: "교재.pdf", mime: "application/pdf", bytes: 1024, sha256: "a".repeat(64) };
const evidence = { policyVersion: materialPolicy.version, deploymentId: "fixture-only", checkedAt: 100, validUntil: 200, acceptedBodyBytes: materialPolicy.types.pdf.maximumBytes, maximumBufferedBytes: 65536, workerMemoryLimitBytes: 134217728, contentValidation: { pdf: true, image: true, text: true }, privateRangeReadVerified: true, storageVerification: materialPolicy.storageVerification, r2WriteReadVerified: true, accountRemainingQuota: "unavailable", additionalPaidResources: false };

describe("자료 업로드 사전 제한", (): void => {
  it("지원 파일별 경계 크기를 허용하고 한 바이트 초과를 거부한다", (): void => {
    const inputs: readonly MaterialMetadata[] = [pdf, { ...pdf, kind: "image", mime: "image/jpeg", filename: "풀이.jpg", role: "answer" }, { ...pdf, kind: "image", mime: "image/png", filename: "사진.png" }, { ...pdf, kind: "text", mime: "text/plain", filename: "원본.txt" }];
    for (const input of inputs) {
      const maximum: number = materialPolicy.types[input.kind].maximumBytes;
      expect(validateMaterialMetadata({ ...input, bytes: maximum }).bytes).toBe(maximum);
      expect(() => validateMaterialMetadata({ ...input, bytes: maximum + 1 })).toThrow(expect.objectContaining({ code: "material_size_exceeded" }));
    }
  });
  it("위장 확장자·MIME·객체 키·신원 주입·경로·빈 제목을 거부한다", (): void => {
    for (const input of [{ ...pdf, filename: "교재.exe" }, { ...pdf, mime: "image/png" }, { ...pdf, kind: "image" }, { ...pdf, ownerId: "other" }, { ...pdf, objectKey: "private/key" }, { ...pdf, filename: "../교재.pdf" }, { ...pdf, title: " " }, { ...pdf, bytes: 0 }]) expect(() => validateMaterialMetadata(input)).toThrow();
    expect(validateMaterialMetadata({ ...pdf, filename: "교재.PDF" })).toMatchObject({ kind: "pdf" });
  });
  it("원본 입력을 바꾸지 않는다", (): void => {
    const input: MaterialMetadata = { ...pdf, title: " 교재 " };
    expect(validateMaterialMetadata(input).title).toBe("교재"); expect(input.title).toBe(" 교재 ");
  });
  it("길이 누락은 스트림 실측에 맡기고 불일치·잘못된 길이는 차단한다", (): void => {
    requireMaterialBodyLength(null, 1024); requireMaterialBodyLength("1024", 1024);
    for (const value of ["0", "1023", "1025", "1e3", " 1024", "9007199254740992"]) expect(() => requireMaterialBodyLength(value, 1024)).toThrow();
  });
  it("사용량·전송 중·미확정 예약 합계의 정확한 256MiB 경계를 검사한다", (): void => {
    requireMaterialStorage(materialPolicy.maximumStorageBytes - 2048, 1024, 1024);
    for (const values of [[materialPolicy.maximumStorageBytes - 2047, 1024, 1024], [0, materialPolicy.maximumStorageBytes, 1], [0, Number.NaN, 1024], [0, 1024, 0], [-1, 0, 1], [0, 0, Number.MAX_SAFE_INTEGER]]) expect(() => requireMaterialStorage(values[0], values[1], values[2])).toThrow();
  });
  it("계정 잔여 용량을 추정하지 않고 승인된 앱 한도와 R2 실측을 요구한다", (): void => {
    expect(requireMaterialRuntime(evidence, 150).accountRemainingQuota).toBe("unavailable");
    for (const value of [{ ...evidence, storageVerification: "unapproved" }, { ...evidence, accountRemainingQuota: 268435456 }, { ...evidence, r2WriteReadVerified: undefined }]) expect(() => requireMaterialRuntime(value, 150)).toThrow();
  });
  it("운영 제한·검증 증거가 빠지거나 만료되면 등록하지 않는다", (): void => {
    expect(requireMaterialRuntime(evidence, 100).deploymentId).toBe("fixture-only");
    for (const value of [null, {}, { ...evidence, r2WriteReadVerified: false }, { ...evidence, acceptedBodyBytes: 1024 }, { ...evidence, maximumBufferedBytes: 65537 }, { ...evidence, contentValidation: { pdf: false, image: true, text: true } }, { ...evidence, additionalPaidResources: true }]) expect(() => requireMaterialRuntime(value, 150)).toThrow(expect.objectContaining({ code: "material_runtime_unverified" }));
    for (const now of [99, 200, Number.NaN]) expect(() => requireMaterialRuntime(evidence, now)).toThrow();
  });
});
