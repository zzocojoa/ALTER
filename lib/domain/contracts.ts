import { z } from "zod";

export const recordId = z.string().uuid().brand<"RecordId">();
export const siteIdentity = z.object({ realm: z.literal("sites"), userId: z.string().min(1).max(200) }).strict();
export const googleIdentity = z.object({ realm: z.literal("google"), subject: z.string().min(1).max(200) }).strict();
export type SiteIdentity = Readonly<z.infer<typeof siteIdentity>>;
export type GoogleIdentity = Readonly<z.infer<typeof googleIdentity>>;
export const version = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const timestamp = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const progress = z.enum(["미시작", "진행 중", "완료"]);
export const performance = z.enum(["미확인", "설명 필요", "도움받아 수행", "독립 수행", "지연 재현"]);
export type Progress = z.infer<typeof progress>;
export type Performance = z.infer<typeof performance>;
export const studyDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value: string): boolean => {
  const parsed: Date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "실제 달력 날짜가 필요합니다.");
export const money = z.object({ currency: z.literal("KRW"), units: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), scale: z.literal(1_000_000) }).strict();
export type Money = Readonly<z.infer<typeof money>>;
export const approvedScopes = ["https://www.googleapis.com/auth/drive.file", "https://www.googleapis.com/auth/calendar.app.created"] as const;
export const scope = z.enum(approvedScopes);
export const policy = Object.freeze({ model: "gpt-6-luna", aiMonthlyKrw: 7_000, operationsMonthlyKrw: 10_000, moneyScale: 1_000_000, existingSubscriptionIncluded: false, googleTransport: "direct-rest-oauth", paidGoogleApisAllowed: false } as const);
export const encryptedToken = z.object({ algorithm: z.literal("AES-GCM"), ciphertext: z.string().regex(/^[A-Za-z0-9_-]{24,}$/), nonce: z.string().regex(/^[A-Za-z0-9_-]{16}$/), keyVersion: z.string().min(1).max(80) }).strict();
export type EncryptedToken = Readonly<z.infer<typeof encryptedToken>>;
export const draftAnswer = z.object({ kind: z.literal("draft"), text: z.string().max(100_000), expectedVersion: version }).strict();
export const submittedAnswer = z.object({ kind: z.literal("submitted"), text: z.string().min(1).max(100_000), reason: z.string().min(1).max(2_000) }).strict();
export const command = z.object({ owner: siteIdentity, requestKey: z.string().min(1).max(200), expectedVersion: version }).strict();
export type Command = Readonly<z.infer<typeof command>>;
export type FailureCode = "validation" | "version_conflict" | "request_key_reused" | "reference_conflict" | "limit_exceeded" | "binding_missing" | "result_unknown" | "storage_failure";
export type DomainFailure = Error & Readonly<{ code: FailureCode; operation: string }>;

/** 비밀값과 요청 본문을 오류 문자열에 포함하지 않습니다. */
export function domainFailure(code: FailureCode, operation: string, cause: unknown): DomainFailure {
  return Object.assign(new Error(`${operation}: ${code}. 요청 상태와 참조 버전을 확인하세요.`, { cause }), { name: "DomainFailure", code, operation });
}

/** 소수 문자열을 정확한 정수 단위로 변환하며 반올림이나 통화 대체를 하지 않습니다. */
export function parseKrw(value: string): Money {
  if (!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(value)) throw domainFailure("validation", "parseKrw", null);
  const parts: string[] = value.split(".");
  const units: bigint = BigInt(parts[0]) * BigInt(policy.moneyScale) + BigInt((parts[1] ?? "").padEnd(6, "0"));
  if (units > BigInt(Number.MAX_SAFE_INTEGER)) throw domainFailure("validation", "parseKrw", null);
  return money.parse({ currency: "KRW", units: Number(units), scale: policy.moneyScale });
}

/** 제공자 리셋 시각은 학습 날짜와 별도로 밀리초 단위 UTC로 보존합니다. */
export function seoulStudyDate(value: number): string {
  timestamp.parse(value);
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

/** 필드 순서에 독립적인 요청 해시를 만들고 비 JSON 값은 거부합니다. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    const object: Record<string, unknown> = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key: string): string => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
  }
  throw domainFailure("validation", "canonicalJson", null);
}

export async function contentHash(value: unknown): Promise<string> {
  const buffer: ArrayBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(value)));
  return Array.from(new Uint8Array(buffer), (byte: number): string => byte.toString(16).padStart(2, "0")).join("");
}
