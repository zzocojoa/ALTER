import { beforeAll, describe, expect, it } from "vitest";
import { issueRestoreChallenge, requireIsolatedRestoreTarget, restorePublicKeyHash, signRestoreAuthorization, verifyRestoreAuthorization } from "../../lib/backup/restore-authority";
import type { RestoreStorageIdentity, RestoreTrust } from "../../lib/backup/restore-authority";
import { backupFixtureId } from "../fixtures/backup-files";

const source: RestoreStorageIdentity = { projectId: "source-site", databaseId: backupFixtureId(1), bucketId: backupFixtureId(2), owner: { realm: "sites", userId: "verified-source-owner" }, purpose: "primary" };
const target: RestoreStorageIdentity = { projectId: "isolated-test-site", databaseId: backupFixtureId(3), bucketId: backupFixtureId(4), owner: { realm: "sites", userId: "verified-target-owner" }, purpose: "restore-test" };
const now: number = 1000000; const end: number = now + 60000; const hash: string = "a".repeat(64); const id: string = backupFixtureId(5);
let pair: CryptoKeyPair; let trust: RestoreTrust;
beforeAll(async () => { pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]); trust = { source, publicKey: pair.publicKey, keySha256: await restorePublicKeyHash(pair.publicKey) }; });
async function signed(destination: RestoreStorageIdentity): Promise<Readonly<{ token: string; challenge: ReturnType<typeof issueRestoreChallenge> }>> { const challenge = issueRestoreChallenge(destination, destination.owner, backupFixtureId(6), now, end); return { challenge, token: await signRestoreAuthorization(pair.privateKey, source, source.owner, challenge, id, hash, now + 1, end) }; }

describe("복원 대상과 양쪽 소유자 승인 증명", () => {
  it("별도 저장소와 다른 서버 확인 소유자 사이의 명시적 승인을 검증한다", async () => {
    const { token, challenge } = await signed(target); const result = await verifyRestoreAuthorization(token, trust, target, target.owner, challenge, id, hash, now + 2);
    expect(result.source.owner).toEqual(source.owner); expect(result.challenge.target.owner).toEqual(target.owner); expect(result.restoredExecutionAuthority).toBe("none"); expect(result.googleConsent).toBe("required");
  });
  it("같은 소유자도 별도 대상 확인과 서명이 필요하다", async () => {
    const same = { ...target, owner: source.owner }; const { token, challenge } = await signed(same);
    expect((await verifyRestoreAuthorization(token, trust, same, same.owner, challenge, id, hash, now + 2)).challenge.target.owner).toEqual(source.owner);
  });
  it("운영 대상과 같은 Site·D1·R2는 각각 거부한다", () => {
    for (const unsafe of [{ ...target, purpose: "primary" as const }, { ...target, projectId: source.projectId }, { ...target, databaseId: source.databaseId }, { ...target, bucketId: source.bucketId }]) expect(() => requireIsolatedRestoreTarget(source, unsafe)).toThrow(/unsafe-target/);
  });
  it("원본·대상 어느 한쪽의 다른 로그인 세션도 거부한다", async () => {
    const { token, challenge } = await signed(target); const other = { realm: "sites" as const, userId: "unconfirmed-owner" };
    expect(() => issueRestoreChallenge(target, other, backupFixtureId(6), now, end)).toThrow(/wrong-owner/);
    await expect(signRestoreAuthorization(pair.privateKey, source, other, challenge, id, hash, now + 1, end)).rejects.toThrow(/wrong-owner/);
    await expect(verifyRestoreAuthorization(token, trust, target, other, challenge, id, hash, now + 2)).rejects.toThrow(/wrong-owner/);
  });
  it("다른 키·위조 서명·다른 백업·다른 챌린지는 승인하지 않는다", async () => {
    const { token, challenge } = await signed(target); const second: CryptoKeyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
    await expect(verifyRestoreAuthorization(token, { ...trust, publicKey: second.publicKey }, target, target.owner, challenge, id, hash, now + 2)).rejects.toThrow(/untrusted-key/);
    await expect(verifyRestoreAuthorization(token, { ...trust, publicKey: second.publicKey, keySha256: await restorePublicKeyHash(second.publicKey) }, target, target.owner, challenge, id, hash, now + 2)).rejects.toThrow(/invalid-signature/);
    await expect(verifyRestoreAuthorization(token, trust, target, target.owner, challenge, backupFixtureId(9), hash, now + 2)).rejects.toThrow(/wrong-backup/);
    await expect(verifyRestoreAuthorization(token, trust, target, target.owner, { ...challenge, id: backupFixtureId(9) }, id, hash, now + 2)).rejects.toThrow(/wrong-challenge/);
    const pieces = token.split("."); const tampered = `${pieces[0]}.${pieces[1][0] === "A" ? "B" : "A"}${pieces[1].slice(1)}`;
    await expect(verifyRestoreAuthorization(tampered, trust, target, target.owner, challenge, id, hash, now + 2)).rejects.toThrow(/invalid-signature/);
  });
  it("만료·미래 발급·과도한 유효 기간과 챌린지보다 긴 승인을 거부한다", async () => {
    const { token, challenge } = await signed(target);
    await expect(verifyRestoreAuthorization(token, trust, target, target.owner, challenge, id, hash, end)).rejects.toThrow(/invalid-time/);
    await expect(verifyRestoreAuthorization(token, trust, target, target.owner, challenge, id, hash, now)).rejects.toThrow(/invalid-time/);
    expect(() => issueRestoreChallenge(target, target.owner, backupFixtureId(6), now, now + 900001)).toThrow(/invalid-time/);
    await expect(signRestoreAuthorization(pair.privateKey, source, source.owner, challenge, id, hash, now + 1, end + 1)).rejects.toThrow(/invalid-time/);
  });
  it("문법·크기 오류에 토큰이나 인증 값을 노출하지 않는다", async () => {
    const { challenge } = await signed(target);
    for (const token of ["secret-token", "a.b.c", "#.#", "a".repeat(8193)]) {
      try { await verifyRestoreAuthorization(token, trust, target, target.owner, challenge, id, hash, now + 2); throw new Error("승인 검증 누락"); }
      catch (error: unknown) { expect(error).toMatchObject({ name: "RestoreAuthorityFailure" }); expect(String(error)).not.toContain(token); }
    }
  });
});
