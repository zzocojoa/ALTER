const authenticationKeys: ReadonlySet<string> = new Set(["accesstoken", "refreshtoken", "idtoken", "clientsecret", "apikey", "privatekey", "authorization", "cookie", "setcookie", "sessiontoken", "sessioncookie", "sessionsecret", "signedurl", "presignedurl", "ciphertext", "codeverifier"]);
const signedQueryKeys: ReadonlySet<string> = new Set(["token", "accesstoken", "refreshtoken", "apikey", "key", "signature", "sig", "googleaccessid", "awsaccesskeyid", "credential", "authorization"]);
function normalizedKey(value: string): string { return value.replace(/[-_]/g, "").toLowerCase(); }
function credentialString(value: string): boolean {
  if (/\b(?:sk-proj-|sk-svcacct-|AIzaSy)[A-Za-z0-9_-]{8,}|\bBearer\s+[A-Za-z0-9._-]{8,}/i.test(value)) return true;
  for (const match of value.matchAll(/https?:\/\/[^\s"'<>\\]+/g)) {
    let url: URL;
    try { url = new URL(match[0]); } catch (error: unknown) { if (!(error instanceof TypeError)) throw error; return true; }
    if (url.username || url.password || Array.from(url.searchParams.keys()).some(key => signedQueryKeys.has(normalizedKey(key)) || /^x-(?:amz|goog)-/i.test(key))) return true;
  }
  return false;
}
/** 명시한 열 계약에 더해 잘못 섞인 인증 데이터도 거부합니다. 학습 회차 ID와 도움 이력은 그대로 보존합니다. */
export function containsAuthenticationMaterial(text: string): boolean {
  const pending: Array<Readonly<{ value: unknown; depth: number }>> = [{ value: text, depth: 0 }];
  while (pending.length > 0) {
    const item = pending.pop();
    if (!item) throw new TypeError("백업 인증 자료 검사 항목이 없습니다.");
    if (item.depth > 64) return true;
    if (typeof item.value === "string") {
      if (credentialString(item.value)) return true;
      const candidate = item.value.trim();
      if (candidate.startsWith("{") || candidate.startsWith("[")) {
        let decoded: unknown;
        try { decoded = JSON.parse(candidate); } catch (error: unknown) { if (!(error instanceof SyntaxError)) throw error; continue; }
        pending.push({ value: decoded, depth: item.depth + 1 });
      }
    } else if (Array.isArray(item.value)) {
      for (const value of item.value) pending.push({ value, depth: item.depth + 1 });
    } else if (typeof item.value === "object" && item.value !== null) {
      for (const [key, value] of Object.entries(item.value)) {
        if (authenticationKeys.has(normalizedKey(key))) return true;
        pending.push({ value, depth: item.depth + 1 });
      }
    }
  }
  return false;
}
