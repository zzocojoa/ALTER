import { z } from "zod";
import { restoreAuthorityFailure, restoreStorageIdentity } from "./restore-authority.ts";
import type { RestoreTrust } from "./restore-authority.ts";

const configuration = z.discriminatedUnion("role", [
  z.object({ role: z.literal("source") }).strict(),
  z.object({ role: z.literal("restore-test"), source: restoreStorageIdentity, sourcePublicKey: z.string().min(1).max(1024), sourceKeySha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
]);
export type RestoreConfiguration = Readonly<z.infer<typeof configuration>>;
export type RestoreTargetConfiguration = Extract<RestoreConfiguration, { role: "restore-test" }>;

/** 설정이 없으면 복원 관리 기능을 사용하지 않습니다. 잘못된 설정은 임의로 운영 모드로 바꾸지 않습니다. */
export function readRestoreConfiguration(value: string | undefined): RestoreConfiguration | null {
  if (value === undefined) return null;
  try { return configuration.parse(JSON.parse(value)); }
  catch (error: unknown) { if (error instanceof z.ZodError || error instanceof SyntaxError) throw restoreAuthorityFailure("invalid-authorization", "ALTER_RESTORE_CONFIGURATION"); throw error; }
}
function keyBytes(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length > 1024) throw restoreAuthorityFailure("untrusted-key", "key-encoding");
  let binary: string;
  try { binary = atob(value); } catch (error: unknown) { if (error instanceof DOMException) throw restoreAuthorityFailure("untrusted-key", "key-encoding"); throw error; }
  if (btoa(binary) !== value) throw restoreAuthorityFailure("untrusted-key", "key-encoding");
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}
export async function importRestoreTrust(value: RestoreTargetConfiguration): Promise<RestoreTrust> {
  try { const publicKey = await crypto.subtle.importKey("spki", keyBytes(value.sourcePublicKey), "Ed25519", true, ["verify"]); return { source: value.source, publicKey, keySha256: value.sourceKeySha256 }; }
  catch (error: unknown) { if (error instanceof DOMException) throw restoreAuthorityFailure("untrusted-key", "public-key-format"); throw error; }
}
export async function importRestoreSigningKey(value: string | undefined): Promise<CryptoKey> {
  if (value === undefined) throw restoreAuthorityFailure("untrusted-key", "ALTER_RESTORE_SIGNING_KEY");
  try { return await crypto.subtle.importKey("pkcs8", keyBytes(value), "Ed25519", false, ["sign"]); }
  catch (error: unknown) { if (error instanceof DOMException) throw restoreAuthorityFailure("untrusted-key", "private-key-format"); throw error; }
}
