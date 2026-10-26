import { importRestoreSigningKey, importRestoreTrust, readRestoreConfiguration } from "../../lib/backup/restore-configuration.ts";
import { issueRestoreChallenge, restoreStorageIdentity, restorePublicKeyHash, signRestoreAuthorization, verifyRestoreAuthorization } from "../../lib/backup/restore-authority.ts";
import type { RestoreStorageIdentity } from "../../lib/backup/restore-authority.ts";

function encode(bytes: ArrayBuffer): string { return btoa(Array.from(new Uint8Array(bytes), byte => String.fromCharCode(byte)).join("")); }
const worker: Readonly<{ fetch(): Promise<Response> }> = { async fetch(): Promise<Response> {
  const pair: CryptoKeyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const source: RestoreStorageIdentity = restoreStorageIdentity.parse({ projectId: "source-test", databaseId: crypto.randomUUID(), bucketId: crypto.randomUUID(), owner: { realm: "sites", userId: "source-owner" }, purpose: "primary" });
  const target: RestoreStorageIdentity = restoreStorageIdentity.parse({ projectId: "target-test", databaseId: crypto.randomUUID(), bucketId: crypto.randomUUID(), owner: { realm: "sites", userId: "target-owner" }, purpose: "restore-test" });
  const configuration = readRestoreConfiguration(JSON.stringify({ role: "restore-test", source, sourcePublicKey: encode(await crypto.subtle.exportKey("spki", pair.publicKey)), sourceKeySha256: await restorePublicKeyHash(pair.publicKey) }));
  if (configuration === null || configuration.role !== "restore-test") throw new Error("시험 복원 설정을 읽지 못했습니다.");
  const key: CryptoKey = await importRestoreSigningKey(encode(await crypto.subtle.exportKey("pkcs8", pair.privateKey)));
  const now: number = Date.now(); const challenge = issueRestoreChallenge(target, target.owner, crypto.randomUUID(), now, now + 60000); const backupId: string = crypto.randomUUID(); const checksum: string = "a".repeat(64);
  const token = await signRestoreAuthorization(key, source, source.owner, challenge, backupId, checksum, now, now + 60000);
  const verified = await verifyRestoreAuthorization(token, await importRestoreTrust(configuration), target, target.owner, challenge, backupId, checksum, now);
  return Response.json({ status: "passed", privateKeyExtractable: key.extractable, differentOwners: verified.source.owner.userId !== verified.challenge.target.owner.userId, executionAuthority: verified.restoredExecutionAuthority, googleConsent: verified.googleConsent });
} };

export default worker;
