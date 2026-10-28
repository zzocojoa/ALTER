import { describe, expect, test } from "vitest";
import { BackupResponseError, backupFailureMessage, requireBackupResponse } from "../../lib/backup/browser-request";

describe("백업 응답 표시 경계", () => {
  test.each([401, 403, 409, 503])("HTTP %s 원문은 오류 근거에 보관하고 화면에 노출하지 않는다", async status => {
    const body: string = JSON.stringify({ message: "token=secret-fixture", error: "private-key-fixture" });
    const result: Promise<Response> = requireBackupResponse(new Response(body, { status }), "/api/backup/test");
    await expect(result).rejects.toMatchObject({ status, endpoint: "/api/backup/test", responseBody: body });
    const error = new BackupResponseError(status, "/api/backup/test", body); expect(backupFailureMessage(error)).toContain(`HTTP ${status}`); expect(backupFailureMessage(error)).not.toMatch(/secret-fixture|private-key-fixture/);
  });
  test("성공 스트림은 오류 검사로 소비하지 않는다", async () => { const response: Response = new Response("bytes"); expect(await requireBackupResponse(response, "/api/backup/test")).toBe(response); expect(await response.text()).toBe("bytes"); });
});
