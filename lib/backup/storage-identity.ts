import { z } from "zod";
import { canonicalJson, siteIdentity } from "../domain/contracts.ts";
import type { SiteIdentity } from "../domain/contracts.ts";
import { createPrivateObject, readPrivateObject } from "../r2-access.ts";
import { readStorage } from "../../db/repositories/atomic.ts";
import { restoreAuthorityFailure, restoreStorageIdentity } from "./restore-authority.ts";
import type { RestoreStorageIdentity } from "./restore-authority.ts";

export const storageMarkerKey: string = ".alter/storage-identity-v1.json";
export const storageMarkerMaximumBytes: number = 2048;
export type StorageMarker = Readonly<{ identity: RestoreStorageIdentity; version: string; bytes: number }>;
export type StorageContext = Readonly<{ projectId: string; owner: SiteIdentity }>;

/** 설정과 소유자는 서버에서 가져오며 요청 본문의 값으로 대체하지 않습니다. */
export function requireStorageOwner(context: StorageContext, authenticatedOwner: SiteIdentity): void {
  siteIdentity.parse(context.owner); siteIdentity.parse(authenticatedOwner);
  if (canonicalJson(context.owner) !== canonicalJson(authenticatedOwner)) throw restoreAuthorityFailure("wrong-owner", "storage-session");
}
export function requireStorageContext(identity: RestoreStorageIdentity, context: StorageContext, purpose: RestoreStorageIdentity["purpose"]): void {
  if (identity.projectId !== context.projectId || canonicalJson(identity.owner) !== canonicalJson(context.owner) || identity.purpose !== purpose) throw restoreAuthorityFailure("unsafe-target", "registered-storage");
}
/** 표식은 작게 제한하고 읽은 뒤 현재 객체 버전도 대조합니다. */
export async function readStorageMarker(bucket: R2Bucket): Promise<StorageMarker | null> {
  const object = await readPrivateObject(bucket, storageMarkerKey);
  if (object === null) return null;
  if (object.size < 1 || object.size > storageMarkerMaximumBytes) { await object.body.cancel(); throw restoreAuthorityFailure("unsafe-target", "marker-size"); }
  const text: string = await object.text(); let identity: RestoreStorageIdentity;
  try { identity = restoreStorageIdentity.parse(JSON.parse(text)); }
  catch (error: unknown) { if (error instanceof z.ZodError || error instanceof SyntaxError) throw restoreAuthorityFailure("unsafe-target", "marker-format"); throw error; }
  if (canonicalJson(identity) !== text || new TextEncoder().encode(text).byteLength !== object.size) throw restoreAuthorityFailure("unsafe-target", "marker-canonical");
  const current = await readStorage("restore.marker-head", () => bucket.head(storageMarkerKey));
  if (current === null || current.version !== object.version || current.size !== object.size) throw restoreAuthorityFailure("unsafe-target", "marker-changed");
  return { identity, version: object.version, bytes: object.size };
}
/** 조건부 생성만 허용합니다. 기존 버킷의 표식은 수정하거나 삭제하지 않습니다. */
export async function createStorageMarker(bucket: R2Bucket, identity: RestoreStorageIdentity): Promise<StorageMarker> {
  const bytes: Uint8Array<ArrayBuffer> = new TextEncoder().encode(canonicalJson(restoreStorageIdentity.parse(identity)));
  if (bytes.byteLength > storageMarkerMaximumBytes) throw restoreAuthorityFailure("unsafe-target", "marker-size");
  await createPrivateObject(bucket, storageMarkerKey, bytes.buffer);
  const observed: StorageMarker | null = await readStorageMarker(bucket);
  if (observed === null || canonicalJson(observed.identity) !== canonicalJson(identity)) throw restoreAuthorityFailure("unsafe-target", "marker-conflict");
  return observed;
}
/** 대상 버킷은 처음에는 비어 있어야 하며 예약 후에는 이 표식만 허용합니다. */
export async function requireEmptyRestoreBucket(bucket: R2Bucket, marker: StorageMarker | null): Promise<void> {
  const listed = await readStorage("restore.bucket-empty", () => bucket.list({ limit: 2 }));
  if (listed.truncated || listed.delimitedPrefixes.length !== 0 || listed.objects.length !== (marker === null ? 0 : 1) || listed.objects.some(object => object.key !== storageMarkerKey || object.version !== marker?.version)) throw restoreAuthorityFailure("unsafe-target", "nonempty-bucket");
}
