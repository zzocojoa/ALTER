import { describe, expect, it } from "vitest";
import { cleanupReply, recoveryReply, registrationReply, requireMaterialResponse } from "../../app/learn/materials/client-api";
import { uploadIssue } from "../../app/learn/materials/upload-issue";

const reply = { id: "00000000-0000-4000-a000-000000000002", materialId: "00000000-0000-4000-a000-000000000003", version: 2 };
describe("자료 완료 응답의 증거 경계", (): void => {
  it("전송 완료와 원본 검증은 등록 완료가 아니다", (): void => {
    for (const state of ["stored", "validating", "verified", "unknown"]) expect(registrationReply.safeParse({ ...reply, state, pages: 1 }).success).toBe(false);
    expect(registrationReply.safeParse({ ...reply, state: "registered", pages: 1 }).success).toBe(true);
  });
  it("상태가 모순된 복구·정리 응답을 거부한다", (): void => {
    expect(recoveryReply.safeParse({ ...reply, state: "unknown", nextAction: "registered" }).success).toBe(false);
    expect(recoveryReply.safeParse({ ...reply, state: "registered", nextAction: "upload" }).success).toBe(false);
    expect(cleanupReply.safeParse({ ...reply, state: "cleaning", nextAction: "new-upload" }).success).toBe(false);
    expect(cleanupReply.safeParse({ ...reply, state: "discarded", nextAction: "new-upload" }).success).toBe(true);
  });
  it("507과 409 응답의 문맥을 유지하고 불명확한 실패와 구분한다", async (): Promise<void> => {
    for (const sample of [{ status: 507, code: "material_storage_unavailable", kind: "capacity" }, { status: 409, code: "request_key_reused", kind: "conflict" }, { status: 503, code: "result_unknown", kind: "unknown" }]) {
      const response: Response = Response.json({ error: sample.code, field: "fixture" }, { status: sample.status });
      try { await requireMaterialResponse(response); throw new Error("오류 응답을 수락했습니다."); }
      catch (error: unknown) { expect(uploadIssue(error, false).kind).toBe(sample.kind); expect(error).toMatchObject({ status: sample.status, code: sample.code, field: "fixture" }); }
    }
  });
});
