export type TrustedIdentity = Readonly<{ userId: string; email: string }>;
export type OwnerDecision =
  | Readonly<{ kind: "owner" }>
  | Readonly<{ kind: "unauthenticated" }>
  | Readonly<{ kind: "forbidden" }>
  | Readonly<{ kind: "restore-quarantined" }>
  | Readonly<{ kind: "configuration-error"; setting: "ALTER_OWNER_USER_ID" | "ALTER_LOCAL_MOCK_AUTH" | "ALTER_RESTORE_CONFIGURATION" }>;

/** 플랫폼이 검증한 신원만 받습니다. 후보 등록이나 이메일로 권한을 부여하지 않습니다. */
export function decideOwner(identity: TrustedIdentity | null, ownerUserId: string | undefined, runtimeMockAuth: string | undefined): OwnerDecision {
  if (runtimeMockAuth !== undefined && runtimeMockAuth !== "0") return { kind: "configuration-error", setting: "ALTER_LOCAL_MOCK_AUTH" };
  if (!ownerUserId || ownerUserId.trim() !== ownerUserId) return { kind: "configuration-error", setting: "ALTER_OWNER_USER_ID" };
  if (!identity || !identity.userId || !identity.email) return { kind: "unauthenticated" };
  return identity.userId === ownerUserId ? { kind: "owner" } : { kind: "forbidden" };
}

/** 로그인 이동은 허용된 앱 경로로만 제한하고 인코딩·정규화 우회는 거부합니다. */
export function requireReturnPath(value: string): string {
  if (!/^\/(?:learn(?:\/materials)?|setup)?(?:[?#].*)?$/.test(value) || /[%\\\u0000-\u0020\u007f]/.test(value)) {
    throw new TypeError("복귀 경로는 /, /learn, /learn/materials, /setup 중 하나여야 하며 인코딩·외부 URL은 허용되지 않습니다.");
  }
  const target: URL = new URL(value, "https://alter.invalid");
  if (target.origin !== "https://alter.invalid") throw new TypeError("다른 출처의 복귀 경로를 사용할 수 없습니다.");
  return `${target.pathname}${target.search}${target.hash}`;
}

/** 변경 요청은 정해진 출처에서만 받아 쿠키를 이용한 교차 출처 쓰기를 차단합니다. */
export function requireSameOrigin(requestOrigin: string | null, siteOrigin: string | undefined): void {
  if (!siteOrigin || new URL(siteOrigin).origin !== siteOrigin) throw new TypeError("ALTER_SITE_ORIGIN에 경로 없는 사이트 출처를 설정하세요.");
  if (requestOrigin !== siteOrigin) throw new DOMException("요청 Origin이 ALTER_SITE_ORIGIN과 일치하지 않습니다.", "SecurityError");
}
