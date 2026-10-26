import { z } from "zod";
import { recordId, siteIdentity, timestamp, canonicalJson } from "../domain/contracts.ts";
import type { SiteIdentity } from "../domain/contracts.ts";

const projectId = z.string().min(1).max(200);
const checksum = z.string().regex(/^[a-f0-9]{64}$/);
export const restoreStorageIdentity = z.object({ projectId, databaseId: recordId, bucketId: recordId, owner: siteIdentity, purpose: z.enum(["primary", "restore-test"]) }).strict();
export type RestoreStorageIdentity = Readonly<z.infer<typeof restoreStorageIdentity>>;
export const restoreChallenge = z.object({ id: recordId, target: restoreStorageIdentity, issuedAt: timestamp, expiresAt: timestamp }).strict();
export type RestoreChallenge = Readonly<z.infer<typeof restoreChallenge>>;
export const restoreAuthorization = z.object({ version: z.literal(1), purpose: z.literal("isolated-backup-restore"), challenge: restoreChallenge, source: restoreStorageIdentity, backupId: recordId, manifestSha256: checksum, issuedAt: timestamp, expiresAt: timestamp, restoredExecutionAuthority: z.literal("none"), googleConsent: z.literal("required") }).strict();
export type RestoreAuthorization = Readonly<z.infer<typeof restoreAuthorization>>;
export type RestoreTrust = Readonly<{ source: RestoreStorageIdentity; publicKey: CryptoKey; keySha256: string }>;
export type RestoreAuthorityCode = "invalid-authorization" | "wrong-owner" | "unsafe-target" | "invalid-time" | "untrusted-key" | "invalid-signature" | "wrong-backup" | "wrong-challenge";
export type RestoreAuthorityFailure = Error & Readonly<{ code: RestoreAuthorityCode; field: string }>;
const maximumLifetime: number = 15 * 60 * 1000;

/** 승인 오류에는 키·서명·소유자 식별자 원문을 포함하지 않습니다. */
export function restoreAuthorityFailure(code: RestoreAuthorityCode, field: string): RestoreAuthorityFailure { return Object.assign(new Error(`복원 승인 검증 실패 (${code}): ${field} 항목을 다시 확인하세요.`), { name: "RestoreAuthorityFailure", code, field }); }
function requireAuthority(condition: boolean, code: RestoreAuthorityCode, field: string): void { if (!condition) throw restoreAuthorityFailure(code, field); }
function requireOwner(actual: SiteIdentity, expected: SiteIdentity): void { siteIdentity.parse(actual); requireAuthority(actual.realm === expected.realm && actual.userId === expected.userId, "wrong-owner", "server-session"); }
function requireWindow(issuedAt: number, expiresAt: number, now: number): void { timestamp.parse(now); requireAuthority(issuedAt <= now && expiresAt > now && expiresAt > issuedAt && expiresAt - issuedAt <= maximumLifetime, "invalid-time", "validity"); }
function encode(bytes: Uint8Array): string { return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join("")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function decode(value: string): Uint8Array<ArrayBuffer> {
  requireAuthority(/^[A-Za-z0-9_-]+$/.test(value), "invalid-authorization", "encoding");
  let binary: string;
  try { binary = atob(value.replace(/-/g, "+").replace(/_/g, "/")); }
  catch (error: unknown) { if (!(error instanceof DOMException)) throw error; throw restoreAuthorityFailure("invalid-authorization", "encoding"); }
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0)); requireAuthority(encode(bytes) === value, "invalid-authorization", "canonical-encoding"); return bytes;
}
/** 논리 Site뿐 아니라 양쪽 저장소 식별자가 모두 달라야 합니다. 브라우저가 보낸 표시는 신뢰하지 않습니다. */
export function requireIsolatedRestoreTarget(sourceValue: RestoreStorageIdentity, targetValue: RestoreStorageIdentity): void {
  const source = restoreStorageIdentity.parse(sourceValue); const target = restoreStorageIdentity.parse(targetValue);
  requireAuthority(target.purpose === "restore-test" && target.projectId !== source.projectId && target.databaseId !== source.databaseId && target.bucketId !== source.bucketId, "unsafe-target", "storage-identity");
}
/** 호출자는 대상 서버의 인증된 세션과 저장소 등록 기록을 사용해야 합니다. */
export function issueRestoreChallenge(targetValue: RestoreStorageIdentity, authenticatedOwner: SiteIdentity, id: string, now: number, expiresAt: number): RestoreChallenge {
  const target = restoreStorageIdentity.parse(targetValue); requireOwner(authenticatedOwner, target.owner);
  requireAuthority(target.purpose === "restore-test", "unsafe-target", "target.purpose"); requireWindow(now, expiresAt, now);
  return restoreChallenge.parse({ id, target, issuedAt: now, expiresAt });
}
/** 완료 백업과 원본 서버 소유자 확인을 마친 뒤 대상 챌린지에 한 번의 승인 범위를 서명합니다. */
export async function signRestoreAuthorization(privateKey: CryptoKey, sourceValue: RestoreStorageIdentity, authenticatedOwner: SiteIdentity, challengeValue: RestoreChallenge, backupId: string, manifestSha256: string, now: number, expiresAt: number): Promise<string> {
  const source = restoreStorageIdentity.parse(sourceValue); const challenge = restoreChallenge.parse(challengeValue);
  requireOwner(authenticatedOwner, source.owner); requireIsolatedRestoreTarget(source, challenge.target); requireWindow(challenge.issuedAt, challenge.expiresAt, now); requireWindow(now, expiresAt, now);
  requireAuthority(expiresAt <= challenge.expiresAt, "invalid-time", "challenge.expiry");
  requireAuthority(privateKey.type === "private" && privateKey.algorithm.name === "Ed25519" && privateKey.usages.includes("sign"), "untrusted-key", "signing-key");
  const payload: RestoreAuthorization = restoreAuthorization.parse({ version: 1, purpose: "isolated-backup-restore", challenge, source, backupId, manifestSha256, issuedAt: now, expiresAt, restoredExecutionAuthority: "none", googleConsent: "required" });
  const bytes: Uint8Array<ArrayBuffer> = new TextEncoder().encode(canonicalJson(payload));
  const signature = new Uint8Array(await crypto.subtle.sign("Ed25519", privateKey, bytes)); return `${encode(bytes)}.${encode(signature)}`;
}
export async function restorePublicKeyHash(publicKey: CryptoKey): Promise<string> {
  requireAuthority(publicKey.type === "public" && publicKey.algorithm.name === "Ed25519" && publicKey.usages.includes("verify") && publicKey.extractable, "untrusted-key", "public-key");
  const raw: ArrayBuffer = await crypto.subtle.exportKey("spki", publicKey); const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", raw)); return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}
function parseAuthorization(bytes: Uint8Array): RestoreAuthorization {
  try {
    const text: string = new TextDecoder("utf-8", { fatal: true }).decode(bytes); const payload = restoreAuthorization.parse(JSON.parse(text));
    requireAuthority(canonicalJson(payload) === text, "invalid-authorization", "canonical-payload"); return payload;
  } catch (error: unknown) { if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof TypeError) throw restoreAuthorityFailure("invalid-authorization", "payload"); throw error; }
}
/** 신뢰 키는 서버 설정에서 고정합니다. 토큰이나 백업 파일이 제시한 공개키로 바꾸지 않습니다. */
export async function verifyRestoreAuthorization(token: string, trust: RestoreTrust, targetValue: RestoreStorageIdentity, authenticatedOwner: SiteIdentity, challengeValue: RestoreChallenge, backupId: string, manifestSha256: string, now: number): Promise<RestoreAuthorization> {
  requireAuthority(token.length <= 8192, "invalid-authorization", "token-size");
  const parts: string[] = token.split("."); requireAuthority(parts.length === 2, "invalid-authorization", "token-format");
  const bytes = decode(parts[0]); const signature = decode(parts[1]); requireAuthority(signature.byteLength === 64, "invalid-signature", "signature-size");
  requireAuthority(await restorePublicKeyHash(trust.publicKey) === checksum.parse(trust.keySha256), "untrusted-key", "key-fingerprint");
  requireAuthority(await crypto.subtle.verify("Ed25519", trust.publicKey, signature, bytes), "invalid-signature", "signature");
  const payload: RestoreAuthorization = parseAuthorization(bytes); const target = restoreStorageIdentity.parse(targetValue); const challenge = restoreChallenge.parse(challengeValue);
  requireAuthority(canonicalJson(payload.source) === canonicalJson(restoreStorageIdentity.parse(trust.source)), "untrusted-key", "source-identity");
  requireOwner(authenticatedOwner, target.owner); requireIsolatedRestoreTarget(payload.source, target);
  requireAuthority(canonicalJson(payload.challenge) === canonicalJson(challenge) && canonicalJson(challenge.target) === canonicalJson(target), "wrong-challenge", "target-challenge");
  requireWindow(payload.issuedAt, payload.expiresAt, now); requireWindow(challenge.issuedAt, challenge.expiresAt, now);
  requireAuthority(payload.expiresAt <= challenge.expiresAt && payload.issuedAt >= challenge.issuedAt, "invalid-time", "challenge-window");
  requireAuthority(payload.backupId === recordId.parse(backupId) && payload.manifestSha256 === checksum.parse(manifestSha256), "wrong-backup", "backup-fingerprint");
  return payload;
}
