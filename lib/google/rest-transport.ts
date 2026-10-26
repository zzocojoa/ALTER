import { z } from "zod";
import { readBoundedGoogleJson } from "./response.ts";
import type { GoogleRestRequest } from "./rest-request.ts";

export type GoogleRestReason = "unauthorized" | "forbidden" | "api-disabled" | "storage-full" | "quota" | "not-found" | "conflict" | "server" | "network" | "invalid-response" | "request-rejected";
export type GoogleRestFailure = Error & Readonly<{ code: "google_rest_failed"; method: GoogleRestRequest["method"]; requestHash: string; status: number | null; reason: GoogleRestReason; outcome: "failed" | "unknown"; retryAfterMs: number | null }>;
export type GoogleRestRuntime = Readonly<{ fetch: (url: string, init: RequestInit) => Promise<Response>; now: () => number; wait: (milliseconds: number) => Promise<void>; warn: (entry: GoogleRestWarning) => void }>;
export type GoogleRestWarning = Readonly<{ event: "google_rest_retry"; method: GoogleRestRequest["method"]; requestHash: string; attempt: number; status: number | null; reason: GoogleRestReason; waitMs: number }>;
export type GoogleRestResult = Readonly<{ status: number; data: unknown; externalId: string | null }>;

export function googleRestFailure(request: GoogleRestRequest, status: number | null, reason: GoogleRestReason, retryAfterMs: number | null): GoogleRestFailure {
  const outcome: "failed" | "unknown" = reason === "network" || reason === "server" || reason === "invalid-response" ? "unknown" : "failed";
  return Object.assign(new Error("Google API 요청을 완료하지 못했어요. 요청 상태와 연결 설정을 확인해 주세요."), { name: "GoogleRestFailure", code: "google_rest_failed" as const, method: request.method, requestHash: request.hash, status, reason, outcome, retryAfterMs });
}
export function googleRetryAfter(value: string | null, now: number): number | null {
  if (value === null) return null;
  const delay: number = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isSafeInteger(delay) && delay >= 0 ? Math.ceil(delay) : null;
}
function providerReason(status: number, body: unknown): GoogleRestReason {
  const parsed = z.object({ error: z.object({ status: z.string().optional(), errors: z.array(z.object({ reason: z.string() })).optional(), details: z.array(z.object({ reason: z.string().optional() })).optional() }) }).safeParse(body);
  const reasons: readonly string[] = parsed.success ? [...(parsed.data.error.errors ?? []).map(item => item.reason), ...(parsed.data.error.details ?? []).flatMap(item => item.reason ? [item.reason] : [])] : [];
  if (reasons.some(reason => ["accessNotConfigured", "SERVICE_DISABLED", "API_DISABLED"].includes(reason))) return "api-disabled";
  if (reasons.includes("storageQuotaExceeded")) return "storage-full";
  if (status === 429 || reasons.some(reason => ["rateLimitExceeded", "userRateLimitExceeded", "dailyLimitExceeded", "quotaExceeded", "QUOTA_EXCEEDED", "RATE_LIMIT_EXCEEDED"].includes(reason))) return "quota";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if ([409, 412].includes(status)) return "conflict";
  return status >= 500 ? "server" : "request-rejected";
}
async function boundedText(response: Response, maximumBytes: number): Promise<string> {
  if (response.body === null) throw new TypeError("Google 텍스트 응답이 없습니다.");
  const reader = response.body.getReader(); const decoder = new TextDecoder("utf-8", { fatal: true });
  let length: number = 0; let text: string = "";
  try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; length += chunk.value.byteLength; if (length > maximumBytes) { await reader.cancel(); throw new RangeError("Google 텍스트 응답 크기를 초과했습니다."); } text += decoder.decode(chunk.value, { stream: true }); } return text + decoder.decode(); }
  finally { reader.releaseLock(); }
}

/** 전송 한 번만 수행하며 토큰·원문·제공사 메시지를 로그나 오류로 전달하지 않습니다. */
export async function fetchGoogleRestResponse(runtime: GoogleRestRuntime, request: GoogleRestRequest, accessToken: string): Promise<Response> {
  const url = new URL(request.url);
  if (url.protocol !== "https:" || !["www.googleapis.com", "docs.googleapis.com", "sheets.googleapis.com"].includes(url.hostname) || url.username || url.password || url.port || !accessToken) throw googleRestFailure(request, null, "request-rejected", null);
  const headers: Headers = new Headers({ authorization: `Bearer ${accessToken}`, accept: request.response === "stream" ? "*/*" : request.response === "text" ? "text/plain" : "application/json" });
  if (request.body !== null) headers.set("content-type", "application/json"); if (request.ifMatch !== null) headers.set("if-match", request.ifMatch);
  let response: Response;
  try { response = await runtime.fetch(request.url, { method: request.httpMethod, headers, body: request.body, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(30_000) }); }
  catch (error: unknown) { if (error instanceof TypeError || error instanceof DOMException) throw googleRestFailure(request, null, "network", null); throw error; }
  const retryAfter: number | null = googleRetryAfter(response.headers.get("retry-after"), runtime.now());
  if (!response.ok) {
    let body: unknown;
    try { body = await readBoundedGoogleJson(response, 65_536); }
    catch (error: unknown) { if (error instanceof Error && ["MaterialFailure", "TypeError", "SyntaxError", "RangeError", "AbortError", "TimeoutError"].includes(error.name)) throw googleRestFailure(request, response.status, providerReason(response.status, null), retryAfter); throw error; }
    throw googleRestFailure(request, response.status, providerReason(response.status, body), retryAfter);
  }
  return response;
}

export async function sendGoogleRestAttempt(runtime:GoogleRestRuntime,request:GoogleRestRequest,accessToken:string):Promise<GoogleRestResult> {
  if(request.response==="stream") throw googleRestFailure(request,null,"request-rejected",null);
  const response=await fetchGoogleRestResponse(runtime,request,accessToken);
  try {
    const data: unknown = request.response === "empty" ? null : request.response === "text" ? await boundedText(response, request.maximumBytes) : await readBoundedGoogleJson(response, request.maximumBytes);
    const id = request.method === "docs.documents.create" ? z.object({ documentId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/) }).parse(data).documentId : request.method === "sheets.spreadsheets.create" ? z.object({ spreadsheetId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/) }).parse(data).spreadsheetId : request.method === "drive.files.create" ? z.object({id:z.string().regex(/^[A-Za-z0-9_-]{1,200}$/)}).parse(data).id : request.method === "calendar.calendars.insert" ? z.object({ id: z.string().regex(/^[A-Za-z0-9_.@-]{1,500}$/).refine(value => value !== "primary") }).parse(data).id : null;
    return { status: response.status, data, externalId: id };
  } catch (error: unknown) { if (error instanceof Error && ["MaterialFailure", "TypeError", "SyntaxError", "RangeError", "ZodError", "AbortError", "TimeoutError"].includes(error.name)) throw googleRestFailure(request, response.status, "invalid-response", null); throw error; }
}

/** 쓰기는 결과 불명 상태에서 재전송하지 않고 조회만 새 quota 예약 후 제한적으로 재시도합니다. */
export function googleRestRetryDelay(request: GoogleRestRequest, error: GoogleRestFailure, attempt: number): number | null {
  if (request.httpMethod !== "GET" || error.status === 403 || attempt >= 3 || !["network", "server", "quota"].includes(error.reason) || error.retryAfterMs !== null && error.retryAfterMs > 30_000) return null;
  return Math.max(error.retryAfterMs ?? 0, 1000 * 2 ** (attempt - 1));
}
