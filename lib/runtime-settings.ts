export type GoogleSettings = Readonly<{ clientId: string; clientSecret: string; tokenEncryptionKey: string }>;
export type ExternalSettings = Readonly<{ GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string; GOOGLE_TOKEN_ENCRYPTION_KEY?: string; OPENAI_API_KEY?: string }>;

/** Google 설정은 Google 기능을 실행할 때만 요구하며 앱 로그인과 분리합니다. */
export function requireGoogleSettings(settings: ExternalSettings): GoogleSettings {
  if (!settings.GOOGLE_CLIENT_ID) throw new TypeError("Google 연결 설정 누락: GOOGLE_CLIENT_ID");
  if (!settings.GOOGLE_CLIENT_SECRET) throw new TypeError("Google 연결 설정 누락: GOOGLE_CLIENT_SECRET");
  if (!settings.GOOGLE_TOKEN_ENCRYPTION_KEY) throw new TypeError("Google 연결 설정 누락: GOOGLE_TOKEN_ENCRYPTION_KEY");
  return { clientId: settings.GOOGLE_CLIENT_ID, clientSecret: settings.GOOGLE_CLIENT_SECRET, tokenEncryptionKey: settings.GOOGLE_TOKEN_ENCRYPTION_KEY };
}

/** 모델·제공사를 우회하지 않고 필요한 키의 이름만 오류에 표시합니다. */
export function requireOpenAIKey(settings: ExternalSettings): string {
  if (!settings.OPENAI_API_KEY) throw new TypeError("AI 설정 누락: OPENAI_API_KEY");
  return settings.OPENAI_API_KEY;
}
