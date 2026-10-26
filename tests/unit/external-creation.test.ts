import { describe, expect, it } from "vitest";
import { prepareExternalCreation } from "../../lib/external/creation.ts";
import type { ExternalWorkflowSeed } from "../../lib/external/creation.ts";

const seed: ExternalWorkflowSeed = { jobId: null, kind: "calendar", targetKey: "fixed", sourceVersion: "1", predecessorId: null, operations: [{ kind: "event", stepKind: "calendar", businessKey: "fixed-event", requestSnapshot: '{"a":1,"b":2}', expectedSnapshot: '{"title":"fixed"}', externalId: "event-id" }] };
describe("외부 요청의 내용 지문", () => {
  it("JSON 순서와 요청 생성용 ID를 내용 변경으로 취급하지 않는다", async () => {
    const first = await prepareExternalCreation(seed, "same-account");
    const reordered = await prepareExternalCreation({ ...seed, jobId: "00000000-0000-4000-a000-000000000015" as ExternalWorkflowSeed["jobId"], operations: seed.operations.map(item => ({ ...item, requestSnapshot: '{ "b":2, "a":1 }' })) }, "same-account");
    expect(first.requestHash).toBe(reordered.requestHash);
    expect(first.operations[0].requestHash).toBe(reordered.operations[0].requestHash);
  });
  it("계정과 확정 버전이 달라지면 같은 작업으로 합치지 않는다", async () => {
    const first = await prepareExternalCreation(seed, "first-account");
    expect((await prepareExternalCreation(seed, "other-account")).requestHash).not.toBe(first.requestHash);
    expect((await prepareExternalCreation({ ...seed, sourceVersion: "2" }, "first-account")).requestHash).not.toBe(first.requestHash);
  });
  it("중복 업무 키와 잘못된 JSON은 외부 전송 전에 거부한다", async () => {
    await expect(prepareExternalCreation({ ...seed, operations: [...seed.operations, ...seed.operations] }, "account")).rejects.toThrow();
    await expect(prepareExternalCreation({ ...seed, operations: seed.operations.map(item => ({ ...item, requestSnapshot: "invalid" })) }, "account")).rejects.toThrow();
  });
});
