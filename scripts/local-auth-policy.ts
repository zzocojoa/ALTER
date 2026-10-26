export type LocalAuthOptions = Readonly<{
  command: "serve" | "build";
  requested: string | undefined;
  profile: "portable" | "managed-linux";
}>;

/** 로컬 인증은 명시적으로 요청한 portable 개발 서버에서만 허용합니다. */
export function resolveLocalMockAuth(options: LocalAuthOptions): boolean {
  if (options.requested !== undefined && options.requested !== "0" && options.requested !== "1") {
    throw new TypeError("ALTER_LOCAL_MOCK_AUTH는 0 또는 1이어야 합니다.");
  }
  const enabled: boolean = options.requested === "1";
  if (enabled && (options.command !== "serve" || options.profile !== "portable")) {
    throw new TypeError("ALTER_LOCAL_MOCK_AUTH=1은 portable 개발 서버에서만 허용됩니다. 빌드·운영에서는 제거하세요.");
  }
  return enabled;
}
