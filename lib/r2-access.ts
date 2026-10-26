function warnRetry(operation: string, attempt: number, error: unknown): void {
  console.warn({ event: "r2_retry", operation, attempt, errorType: error instanceof Error ? error.name : "unknown" });
}

async function backoff(attempt: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, attempt * 100));
}

/** 읽기 실패를 제한적으로 재시도하고 마지막 서비스 오류를 보존합니다. */
export async function readPrivateObject(bucket: R2Bucket, key: string): Promise<R2ObjectBody | null> {
  for (let attempt: number = 1; attempt <= 3; attempt += 1) {
    try { return await bucket.get(key); } catch (error) {
      if (attempt === 3) throw error;
      warnRetry("get", attempt, error);
      await backoff(attempt);
    }
  }
  throw new Error("R2 읽기 재시도 범위를 벗어났습니다.");
}

/** 응답 유실 시 기존 객체를 먼저 대조하며 확인되지 않은 쓰기를 반복하지 않습니다. */
export async function createPrivateObject(bucket: R2Bucket, key: string, data: ArrayBuffer): Promise<R2Object | null> {
  for (let attempt: number = 1; attempt <= 3; attempt += 1) {
    try { return await bucket.put(key, data, { onlyIf: { etagDoesNotMatch: "*" } }); } catch (error) {
      const observed: R2ObjectBody | null = await readPrivateObject(bucket, key);
      if (observed) {
        if (observed.size !== data.byteLength) throw new Error("R2 쓰기 결과 충돌: 기존 객체의 크기가 요청과 다릅니다.", { cause: error });
        const saved: Uint8Array = new Uint8Array(await observed.arrayBuffer());
        const intended: Uint8Array = new Uint8Array(data);
        if (!saved.every((byte, index) => byte === intended[index])) throw new Error("R2 쓰기 결과 충돌: 기존 객체 내용이 요청과 다릅니다.", { cause: error });
        return observed;
      }
      if (attempt === 3) throw error;
      warnRetry("create_after_confirmed_absence", attempt, error);
      await backoff(attempt);
    }
  }
  throw new Error("R2 쓰기 재시도 범위를 벗어났습니다.");
}

/** 동일 키의 삭제만 재시도하며 성공 후 실제 부재를 확인합니다. */
export async function deletePrivateObject(bucket: R2Bucket, key: string): Promise<void> {
  for (let attempt: number = 1; attempt <= 3; attempt += 1) {
    try {
      await bucket.delete(key);
      if (await readPrivateObject(bucket, key) !== null) throw new Error("R2 삭제 결과 미확인: 객체가 남아 있습니다.");
      return;
    } catch (error) {
      if (attempt === 3) throw error;
      warnRetry("delete", attempt, error);
      await backoff(attempt);
    }
  }
}
