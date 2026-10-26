import { readBoundedJson } from "../materials/request.ts";
import { materialFailure } from "../materials/policy.ts";

/** Fetch가 해제한 압축 본문은 전송 길이와 비교하지 않고 실제 읽은 바이트에 상한을 적용합니다. */
export async function readBoundedGoogleJson(response: Response, maximumBytes: number): Promise<unknown> {
  const encoding: string | null = response.headers.get("content-encoding");
  const headers: Headers = new Headers(response.headers);
  if (encoding !== null && encoding !== "identity") {
    if (!["gzip", "br", "deflate"].includes(encoding.toLowerCase().trim())) throw materialFailure("material_request_invalid", "google-response-content-encoding", 415);
    headers.delete("content-length");
  }
  return readBoundedJson({ headers, body: response.body }, maximumBytes);
}
