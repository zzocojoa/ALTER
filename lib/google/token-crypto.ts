import { z } from "zod";
import { canonicalJson, encryptedToken, recordId, timestamp, version } from "../domain/contracts.ts";
import type { EncryptedToken } from "../domain/contracts.ts";
import { googleFailure } from "./errors.ts";

const encryptionKey = z.object({ version: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/), value: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();
const tokenKeyring = z.object({ activeVersion: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/), keys: z.array(encryptionKey).min(1).max(5) }).strict().refine((value): boolean => new Set(value.keys.map(key => key.version)).size === value.keys.length && value.keys.some(key => key.version === value.activeVersion));
export type GoogleTokenKeyring = Readonly<z.infer<typeof tokenKeyring>>;
const tokenBinding = z.object({ ownerId: z.string().min(1).max(200), connectionId: recordId, generation: version }).strict();
export type GoogleTokenBinding = Readonly<z.infer<typeof tokenBinding>>;
export const googleTokenBundle = z.object({ accessToken: z.string().min(1).max(8192), refreshToken: z.string().min(1).max(8192), authorizedAt: timestamp }).strict();
export type GoogleTokenBundle = Readonly<z.infer<typeof googleTokenBundle>>;

export function googleBase64Url(bytes: Uint8Array<ArrayBuffer>): string { return btoa(Array.from(bytes, (byte: number): string => String.fromCharCode(byte)).join("")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 32_768 || value.length % 4 === 1) throw googleFailure("google_token_integrity_invalid", "base64");
  let decoded: string;
  try { decoded = atob(value.replace(/-/g, "+").replace(/_/g, "/")); }
  catch (error: unknown) { if (error instanceof DOMException) throw googleFailure("google_token_integrity_invalid", "base64"); throw error; }
  const bytes: Uint8Array<ArrayBuffer> = Uint8Array.from(decoded, (char: string): number => char.charCodeAt(0));
  if (googleBase64Url(bytes) !== value) throw googleFailure("google_token_integrity_invalid", "base64-canonical");
  return bytes;
}

/** GOOGLE_TOKEN_ENCRYPTION_KEY는 activeVersion과 keys 배열을 가진 서버 전용 JSON입니다. */
export function requireGoogleTokenKeyring(raw: string): GoogleTokenKeyring {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch (error: unknown) { if (error instanceof SyntaxError) throw googleFailure("google_token_key_missing", "keyring-json"); throw error; }
  const result = tokenKeyring.safeParse(parsed);
  if (!result.success) throw googleFailure("google_token_key_missing", "keyring-schema");
  for (const key of result.data.keys) if (decodeBase64Url(key.value).byteLength !== 32) throw googleFailure("google_token_key_missing", "key-length");
  return result.data;
}
async function importTokenKey(keyring: GoogleTokenKeyring, keyVersion: string): Promise<CryptoKey> {
  const parsed = tokenKeyring.safeParse(keyring);
  if (!parsed.success) throw googleFailure("google_token_key_missing", "keyring-schema");
  const key = parsed.data.keys.find(item => item.version === keyVersion);
  if (!key) throw googleFailure("google_token_key_missing", "key-version");
  const bytes: Uint8Array<ArrayBuffer> = decodeBase64Url(key.value);
  if (bytes.byteLength !== 32) throw googleFailure("google_token_key_missing", "key-length");
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
function tokenAdditionalData(binding: GoogleTokenBinding, keyVersion: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(canonicalJson({ purpose: "alter-google-token-bundle-v1", ...tokenBinding.parse(binding), keyVersion }));
}

/** 새 nonce를 매번 생성하고 소유자·연결·세대·키 버전을 인증 데이터에 결합합니다. */
export async function encryptGoogleTokenBundle(bundle: GoogleTokenBundle, binding: GoogleTokenBinding, keyring: GoogleTokenKeyring): Promise<EncryptedToken> {
  const parsed = googleTokenBundle.safeParse(bundle);
  if (!parsed.success) throw googleFailure("google_token_integrity_invalid", "token-bundle");
  const key: CryptoKey = await importTokenKey(keyring, keyring.activeVersion);
  const nonce: Uint8Array<ArrayBuffer> = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext: ArrayBuffer = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: tokenAdditionalData(binding, keyring.activeVersion), tagLength: 128 }, key, new TextEncoder().encode(JSON.stringify(parsed.data)));
  return encryptedToken.parse({ algorithm: "AES-GCM", ciphertext: googleBase64Url(new Uint8Array(ciphertext)), nonce: googleBase64Url(nonce), keyVersion: keyring.activeVersion });
}
export async function decryptGoogleTokenBundle(value: EncryptedToken, binding: GoogleTokenBinding, keyring: GoogleTokenKeyring): Promise<GoogleTokenBundle> {
  const parsed = encryptedToken.safeParse(value);
  if (!parsed.success) throw googleFailure("google_token_integrity_invalid", "ciphertext-schema");
  const key: CryptoKey = await importTokenKey(keyring, parsed.data.keyVersion);
  let plaintext: ArrayBuffer;
  try { plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decodeBase64Url(parsed.data.nonce), additionalData: tokenAdditionalData(binding, parsed.data.keyVersion), tagLength: 128 }, key, decodeBase64Url(parsed.data.ciphertext)); }
  catch (error: unknown) { if (error instanceof DOMException) throw googleFailure("google_token_integrity_invalid", "authenticated-decryption"); throw error; }
  let content: unknown;
  try { content = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)); }
  catch (error: unknown) { if (error instanceof SyntaxError || error instanceof TypeError) throw googleFailure("google_token_integrity_invalid", "token-plaintext"); throw error; }
  const bundle = googleTokenBundle.safeParse(content);
  if (!bundle.success) throw googleFailure("google_token_integrity_invalid", "token-bundle");
  return bundle.data;
}

/** 이전 키를 남긴 keyring으로 읽고 새 activeVersion으로 재암호화한 뒤 조건부 저장합니다. */
export async function reencryptGoogleTokenBundle(value: EncryptedToken, binding: GoogleTokenBinding, keyring: GoogleTokenKeyring): Promise<EncryptedToken> {
  return encryptGoogleTokenBundle(await decryptGoogleTokenBundle(value, binding, keyring), binding, keyring);
}
