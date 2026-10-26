import { afterEach, expect, test, vi } from "vitest";
import type { Mock } from "vitest";
import { verifyPrivateFileAccess } from "@/lib/private-file-probe";

const id: string = "04b4df38-a87f-455a-bcfa-60e16e078e54";
const payload: string = `ALTER disposable access check ${id}`;
const path: string = `/api/files/${id}`;

function setupRequests(): Mock<typeof fetch> {
  vi.spyOn(crypto, "randomUUID").mockReturnValue(id);
  const request: Mock<typeof fetch> = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", request);
  return request;
}

afterEach(() => { vi.unstubAllGlobals(); });

test("브라우저 세션으로 생성·조회·삭제·부재를 확인한다", async () => {
  const request = setupRequests();
  request.mockResolvedValueOnce(Response.json({ id }, { status: 201 }))
    .mockResolvedValueOnce(new Response(payload)).mockResolvedValueOnce(new Response(payload))
    .mockResolvedValueOnce(Response.json({ deleted: true })).mockResolvedValueOnce(new Response(null, { status: 404 }));
  await expect(verifyPrivateFileAccess(new AbortController().signal)).resolves.toEqual({ create: 201, read: 200, remove: 200, absent: 404 });
  expect(request.mock.calls.map((call) => call[1]?.method)).toEqual(["PUT", "GET", "GET", "DELETE", "GET"]);
  for (const [url, options] of request.mock.calls) {
    expect(url).toBe(path);
    expect(options).toMatchObject({ credentials: "same-origin", cache: "no-store" });
  }
});

test("생성 응답 유실 후 실제 내용을 확인하고 정리하며 원래 오류를 보존한다", async () => {
  const request = setupRequests();
  const failure: TypeError = new TypeError("synthetic lost response");
  request.mockRejectedValueOnce(failure).mockResolvedValueOnce(new Response(payload))
    .mockResolvedValueOnce(Response.json({ deleted: true })).mockResolvedValueOnce(new Response(null, { status: 404 }));
  await expect(verifyPrivateFileAccess(new AbortController().signal)).rejects.toBe(failure);
  expect(request.mock.calls.map((call) => call[1]?.method)).toEqual(["PUT", "GET", "DELETE", "GET"]);
});

test("조회 실패와 정리 실패를 둘 다 보존한다", async () => {
  const request = setupRequests();
  request.mockResolvedValueOnce(Response.json({ id }, { status: 201 }))
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(new Response(null, { status: 503 }));
  await expect(verifyPrivateFileAccess(new AbortController().signal)).rejects.toBeInstanceOf(AggregateError);
  expect(request.mock.calls.some((call) => call[1]?.method === "DELETE")).toBe(false);
});

test("충돌한 파일이 검사 내용과 다르면 삭제하지 않는다", async () => {
  const request = setupRequests();
  request.mockResolvedValueOnce(new Response(null, { status: 409 })).mockResolvedValueOnce(new Response("existing data"));
  await expect(verifyPrivateFileAccess(new AbortController().signal)).rejects.toBeInstanceOf(AggregateError);
  expect(request.mock.calls.some((call) => call[1]?.method === "DELETE")).toBe(false);
});

test("삭제 뒤 파일이 남아 있으면 성공으로 처리하지 않는다", async () => {
  const request = setupRequests();
  request.mockResolvedValueOnce(Response.json({ id }, { status: 201 }))
    .mockResolvedValueOnce(new Response(payload)).mockResolvedValueOnce(new Response(payload))
    .mockResolvedValueOnce(Response.json({ deleted: true })).mockResolvedValueOnce(new Response(payload));
  await expect(verifyPrivateFileAccess(new AbortController().signal)).rejects.toThrow("private_file_probe_http_failure");
});

test("취소된 검사의 정리는 별도의 유효한 신호로 수행한다", async () => {
  const request = setupRequests();
  const controller: AbortController = new AbortController();
  controller.abort();
  request.mockRejectedValueOnce(new DOMException("synthetic abort", "AbortError"))
    .mockResolvedValueOnce(new Response(null, { status: 404 }));
  await expect(verifyPrivateFileAccess(controller.signal)).rejects.toThrow("synthetic abort");
  expect(request.mock.calls[0][1]?.signal?.aborted).toBe(true);
  expect(request.mock.calls[1][1]?.signal?.aborted).toBe(false);
});

test("생성 뒤 사라진 파일은 삭제 검증 통과로 기록하지 않는다", async () => {
  const request = setupRequests();
  request.mockResolvedValueOnce(Response.json({ id }, { status: 201 }))
    .mockResolvedValueOnce(new Response(payload)).mockResolvedValueOnce(new Response(null, { status: 404 }));
  await expect(verifyPrivateFileAccess(new AbortController().signal)).rejects.toThrow("private_file_probe_missing_before_delete");
});
