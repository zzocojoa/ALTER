/** 원시 R2 키를 받지 않고 단일 UUID만 고정된 비공개 경로에 대응시킵니다. */
export function privateFileKey(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) throw new TypeError("파일 ID는 UUID v4여야 합니다.");
  return `private/${id}`;
}
