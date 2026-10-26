import { describe, expect, it } from "vitest";
import { materialRequestKey, parseMaterialStart, readMaterialJson, requireMaterialTransferBody } from "../../lib/materials/request";
import type { MaterialMetadata } from "../../lib/materials/policy";

const courseId: string = "da79e222-15a1-4354-bb7e-72d17b30c446";
const metadata: MaterialMetadata = { title: "교재", edition: "1판", role: "reference", kind: "text", filename: "교재.txt", mime: "text/plain", bytes: 10, sha256: "a".repeat(64) };
function request(body: string | Uint8Array, headers: HeadersInit): Request { return new Request("https://alter.test/api/materials/uploads", { method: "POST", headers, body: body as BodyInit }); }
describe("자료 요청 입력 계약", (): void => {
  it("소유자·자료·객체·업로드 식별자 주입을 거부한다", (): void => {
    for (const field of ["ownerId", "materialId", "objectKey", "uploadId"]) expect(() => parseMaterialStart({ courseId, metadata, [field]: "injected" })).toThrow();
    expect(parseMaterialStart({ courseId, metadata }).metadata).toEqual(metadata);
  });
  it("요청 키는 명시된 UUID만 받는다", (): void => {
    expect(materialRequestKey(new Headers({ "idempotency-key": courseId }))).toBe(courseId);
    for (const key of ["", "../key", "sk-proj-example"]) expect(() => materialRequestKey(new Headers({ "idempotency-key": key }))).toThrow();
  });
  it("메타데이터는 길이 선언 없이도 실제 16KiB 경계를 검사한다", async (): Promise<void> => {
    expect(await readMaterialJson(request(JSON.stringify({ courseId, metadata }), { "content-type": "application/json" }))).toEqual({ courseId, metadata });
    await expect(readMaterialJson(request('"' + 'a'.repeat(16383) + '"', { "content-type": "application/json" }))).rejects.toMatchObject({ status: 413 });
    expect((await readMaterialJson(request('"' + 'a'.repeat(16382) + '"', { "content-type": "application/json" })) as string).length).toBe(16382);
  });
  it("잘못된 JSON·UTF-8·선언 길이·콘텐츠 유형을 거부한다", async (): Promise<void> => {
    for (const input of [request('{', { "content-type": "application/json" }), request(new Uint8Array([255]), { "content-type": "application/json" }), request('{}', { "content-type": "application/json", "content-length": "3" }), request('{}', { "content-type": "text/plain" }), request('{}', { "content-type": "application/json", "content-length": "99999" })]) await expect(readMaterialJson(input)).rejects.toMatchObject({ code: "material_request_invalid" });
  });
  it("원본 본문은 예약 MIME·길이와 일치해야 하며 압축을 받지 않는다", (): void => {
    requireMaterialTransferBody(request("0123456789", { "content-type": "text/plain" }), metadata);
    const invalidHeaders: readonly HeadersInit[] = [{ "content-type": "application/pdf" }, { "content-type": "text/plain", "content-length": "9" }, { "content-type": "text/plain", "content-encoding": "gzip" }];
    for (const headers of invalidHeaders) expect(() => requireMaterialTransferBody(request("0123456789", headers), metadata)).toThrow();
  });
});
