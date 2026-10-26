import { describe, expect, it } from "vitest";
import { resolveLocalMockAuth } from "../../scripts/local-auth-policy";
import { requireStorageBindings } from "../../lib/storage-bindings";

describe("로컬 인증 경계", () => {
  it("기본값은 비활성이며 명시적인 portable 개발 요청만 허용한다", () => {
    expect(resolveLocalMockAuth({ command: "serve", requested: undefined, profile: "portable" })).toBe(false);
    expect(resolveLocalMockAuth({ command: "serve", requested: "0", profile: "portable" })).toBe(false);
    const options = Object.freeze({ command: "serve", requested: "1", profile: "portable" } as const);
    expect(resolveLocalMockAuth(options)).toBe(true);
    expect(options.requested).toBe("1");
  });
  it("빌드·관리 환경·잘못된 설정은 명시적으로 거부한다", () => {
    expect(() => resolveLocalMockAuth({ command: "build", requested: "1", profile: "portable" })).toThrow(/ALTER_LOCAL_MOCK_AUTH/);
    expect(() => resolveLocalMockAuth({ command: "serve", requested: "1", profile: "managed-linux" })).toThrow(/portable/);
    expect(() => resolveLocalMockAuth({ command: "serve", requested: "true", profile: "portable" })).toThrow(/0 또는 1/);
  });
});

describe("저장소 바인딩", () => {
  it("바인딩 누락을 숨기지 않는다", () => {
    expect(() => requireStorageBindings({})).toThrow(/DB/);
    const db = Object.freeze({ prepare: () => { throw new Error("미사용"); }, batch: () => { throw new Error("미사용"); } }) as unknown as D1Database;
    expect(() => requireStorageBindings({ DB: db })).toThrow(/BUCKET/);
  });
  it("검사 중 입력을 변경하지 않는다", () => {
    const input = Object.freeze({ DB: Object.freeze({ prepare: () => { throw new Error("미사용"); }, batch: () => { throw new Error("미사용"); } }) as unknown as D1Database, BUCKET: Object.freeze({ get: () => { throw new Error("미사용"); }, put: () => { throw new Error("미사용"); }, delete: () => { throw new Error("미사용"); } }) as unknown as R2Bucket });
    const output = requireStorageBindings(input);
    expect(output).toEqual(input);
    expect(output).not.toBe(input);
  });
});
