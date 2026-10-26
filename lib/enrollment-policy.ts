/** 한시적 신원 확인만 허용하며 저장된 후보에게 앱 권한을 부여하지 않습니다. */
export function enrollmentEnabled(ownerId: string | undefined, expiresAt: string | undefined, now: number): boolean {
  if (ownerId || !expiresAt) return false;
  const expiry: number = Date.parse(expiresAt);
  if (!Number.isFinite(expiry)) throw new TypeError("ALTER_OWNER_ENROLLMENT_EXPIRES_AT는 ISO 날짜여야 합니다.");
  return expiry > now;
}
