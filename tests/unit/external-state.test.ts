import { describe, expect, it } from "vitest";
import { summarizeExternalOperations, transitionExternalOperation } from "../../lib/external/state.ts";

describe("외부 작업의 응답과 확인 분리", () => {
  it("성공 응답만 받은 작업은 확인 완료가 아니다", () => {
    const sent = transitionExternalOperation("pending", "claim-write");
    const received = transitionExternalOperation(sent, "write-response");
    expect(received).toBe("received");
    expect(summarizeExternalOperations(["confirmed", received])).toBe("running");
    expect(() => transitionExternalOperation(received, "content-matched")).toThrow();
    expect(transitionExternalOperation(transitionExternalOperation(received, "claim-verification"), "content-matched")).toBe("confirmed");
  });
  it("임대 만료와 오류가 쓰기 실행권을 복원하지 않는다", () => {
    const unknown = transitionExternalOperation("running", "lease-expired");
    expect(unknown).toBe("unknown");
    for (const state of [unknown, "failed", "received"] as const) {
      expect(() => transitionExternalOperation(state, "claim-write")).toThrow();
      expect(transitionExternalOperation(state, "claim-verification")).toBe("running");
    }
  });
  it("완료와 내용 충돌은 자동 재실행하거나 덮어쓰지 않는다", () => {
    for (const state of ["confirmed", "conflict"] as const) for (const event of ["claim-write", "claim-verification", "lease-expired", "write-response"] as const) expect(() => transitionExternalOperation(state, event)).toThrow();
  });
  it("충돌은 별도의 명시적 재조회로만 선점할 수 있다",()=>{expect(transitionExternalOperation("conflict","claim-conflict-verification")).toBe("running");expect(()=>transitionExternalOperation("confirmed","claim-conflict-verification")).toThrow();});
  it("성공 단계가 있어도 미확정·실패·충돌을 숨기지 않는다", () => {
    expect(summarizeExternalOperations(["confirmed", "pending"])).toBe("partial");
    for (const state of ["unknown", "failed", "conflict"] as const) expect(summarizeExternalOperations(["confirmed", state])).toBe(state);
    expect(summarizeExternalOperations(["confirmed", "confirmed"])).toBe("confirmed");
    expect(() => summarizeExternalOperations([])).toThrow();
  });
});
