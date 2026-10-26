export type StorageBindings = Readonly<{ DB: D1Database; BUCKET: R2Bucket }>;

/** 누락되거나 다른 타입으로 연결된 저장소에서 처리를 시작하지 않습니다. */
export function requireStorageBindings(bindings: Partial<StorageBindings>): StorageBindings {
  if (!bindings.DB || typeof bindings.DB.prepare !== "function" || typeof bindings.DB.batch !== "function") {
    throw new TypeError("D1 바인딩 DB의 prepare·batch가 없습니다. Sites 바인딩을 확인하세요.");
  }
  if (!bindings.BUCKET || typeof bindings.BUCKET.get !== "function" || typeof bindings.BUCKET.put !== "function" || typeof bindings.BUCKET.delete !== "function") {
    throw new TypeError("R2 바인딩 BUCKET의 get·put·delete가 없습니다. Sites 바인딩을 확인하세요.");
  }
  return { DB: bindings.DB, BUCKET: bindings.BUCKET };
}
