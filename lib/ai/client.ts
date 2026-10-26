import OpenAI from "openai";
import type { ClientOptions } from "openai";
import { aiSupportContract } from "./support.ts";

export type ModelFetch = NonNullable<ClientOptions["fetch"]>;
/** SDK 내부 재시도·환경변수의 다른 조직·임의 API 주소를 사용하지 않습니다. */
export function createAiClient(apiKey: string, fetch: ModelFetch): OpenAI {
  if (!apiKey) throw new TypeError("AI 설정 누락: OPENAI_API_KEY");
  return new OpenAI({ apiKey, baseURL: aiSupportContract.apiOrigin, maxRetries: 0, timeout: 30_000, organization: null, project: null, dangerouslyAllowBrowser: false, logLevel: "off", fetch });
}
