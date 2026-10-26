import { describe, expect, it } from "vitest";
import { recordId } from "../../lib/domain/contracts.ts";
import { decryptGoogleTokenBundle, encryptGoogleTokenBundle, googleBase64Url, reencryptGoogleTokenBundle, requireGoogleTokenKeyring } from "../../lib/google/token-crypto.ts";
import type { GoogleTokenBinding, GoogleTokenBundle, GoogleTokenKeyring } from "../../lib/google/token-crypto.ts";

const bundle: GoogleTokenBundle = { accessToken: "access-secret", refreshToken: "refresh-secret", authorizedAt: 1000 };
const binding: GoogleTokenBinding = { ownerId: "owner", connectionId: recordId.parse("00000000-0000-4000-a000-000000001400"), generation: 1 };
const keyring: GoogleTokenKeyring = { activeVersion: "v1", keys: [{ version: "v1", value: googleBase64Url(new Uint8Array(32).fill(1)) }] };

describe("Google 토큰 인증 암호화", () => {
  it("평문을 저장 자료에 포함하지 않고 nonce를 매번 새로 생성한다", async () => {
    const first = await encryptGoogleTokenBundle(bundle, binding, keyring);
    const second = await encryptGoogleTokenBundle(bundle, binding, keyring);
    expect(first.nonce).not.toBe(second.nonce); expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(JSON.stringify(first)).not.toMatch(/access-secret|refresh-secret/);
    await expect(decryptGoogleTokenBundle(first, binding, keyring)).resolves.toEqual(bundle);
  });
  it("다른 소유자·연결·세대로 암호문을 옮기거나 태그를 바꾸면 거부한다", async () => {
    const encrypted = await encryptGoogleTokenBundle(bundle, binding, keyring);
    for (const change of [{ ownerId: "other" }, { connectionId: recordId.parse("00000000-0000-4000-a000-000000001401") }, { generation: 2 }]) await expect(decryptGoogleTokenBundle(encrypted, { ...binding, ...change }, keyring)).rejects.toMatchObject({ code: "google_token_integrity_invalid" });
    const changed: string = (encrypted.ciphertext[0] === "A" ? "B" : "A") + encrypted.ciphertext.slice(1);
    await expect(decryptGoogleTokenBundle({ ...encrypted, ciphertext: changed }, binding, keyring)).rejects.toMatchObject({ code: "google_token_integrity_invalid" });
    await expect(decryptGoogleTokenBundle({ ...encrypted, nonce: "A".repeat(16) }, binding, keyring)).rejects.toMatchObject({ code: "google_token_integrity_invalid" });
  });
  it("키 누락·잘못된 키·키 버전 변조를 명시적으로 차단한다", async () => {
    const encrypted = await encryptGoogleTokenBundle(bundle, binding, keyring);
    await expect(decryptGoogleTokenBundle({ ...encrypted, keyVersion: "missing" }, binding, keyring)).rejects.toMatchObject({ code: "google_token_key_missing" });
    const wrong: GoogleTokenKeyring = { activeVersion: "v1", keys: [{ version: "v1", value: googleBase64Url(new Uint8Array(32).fill(2)) }] };
    await expect(decryptGoogleTokenBundle(encrypted, binding, wrong)).rejects.toMatchObject({ code: "google_token_integrity_invalid" });
    for (const raw of ["", "not-json", '{"activeVersion":"v1","keys":[]}', JSON.stringify({ ...keyring, activeVersion: "missing" })]) expect(() => requireGoogleTokenKeyring(raw)).toThrow();
  });
  it("이전 키로 읽은 뒤 새 버전과 nonce로 재암호화한다", async () => {
    const encrypted = await encryptGoogleTokenBundle(bundle, binding, keyring);
    const rotated: GoogleTokenKeyring = { activeVersion: "v2", keys: [...keyring.keys, { version: "v2", value: googleBase64Url(new Uint8Array(32).fill(2)) }] };
    const changed = await reencryptGoogleTokenBundle(encrypted, binding, rotated);
    expect(changed.keyVersion).toBe("v2"); expect(changed.nonce).not.toBe(encrypted.nonce);
    await expect(decryptGoogleTokenBundle(changed, binding, rotated)).resolves.toEqual(bundle);
    await expect(decryptGoogleTokenBundle(changed, binding, keyring)).rejects.toMatchObject({ code: "google_token_key_missing" });
  });
});
