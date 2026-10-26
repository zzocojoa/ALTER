import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import { z } from "zod";
import { aiSupportContract } from "../../lib/ai/support";

const probeOutput = z.object({ acknowledged: z.boolean() }).strict();
const usage = Object.freeze({ input_tokens: 12, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0, cache_write_tokens_details: { ttl_30m_tokens: 0, ttl_12h_tokens: 0 } }, output_tokens: 4, output_tokens_details: { reasoning_tokens: 1 }, total_tokens: 16 });
export type SdkProbeReport = Readonly<{ environment: "mock"; model: string; strictFormat: boolean; image: boolean; responseId: string; usageBeforeParseFailure: number; parseRejected: boolean; streamEvents: number; sdkRetries: number; https: boolean }>;

function responseFixture(text: string): object {
  return { id: "resp_fixture", object: "response", created_at: 1, model: aiSupportContract.model, status: "completed", output: [{ type: "message", id: "msg_fixture", status: "completed", role: "assistant", content: [{ type: "output_text", text, annotations: [] }] }], usage };
}

/** 로컬 검사 전용 전송으로 외부 연결과 실제 키 사용을 금지합니다. */
export async function runSdkProbe(): Promise<SdkProbeReport> {
  const requests: Request[] = [];
  const client: OpenAI = new OpenAI({ apiKey: "fixture-only-not-a-secret", baseURL: aiSupportContract.apiOrigin, maxRetries: 0, timeout: 1000, organization: null, project: null, logLevel: "off", fetch: async (input, init): Promise<Response> => {
    const request: Request = new Request(input, init);
    requests.push(request);
    if (request.url !== "https://api.openai.com/v1/responses") throw new Error("검사 요청의 공식 HTTPS 경로가 다릅니다.");
    const body: { stream?: boolean; instructions?: string } = await request.clone().json();
    if (body.instructions === "reject") return Response.json({ error: { message: "fixture", type: "rate_limit_error", code: "rate_limit_exceeded" } }, { status: 429 });
    if (body.stream) return new Response('event: response.completed\ndata: ' + JSON.stringify({ type: "response.completed", sequence_number: 0, response: responseFixture('{"acknowledged":true}') }) + '\n\ndata: [DONE]\n\n', { headers: { "Content-Type": "text/event-stream" } });
    return Response.json(responseFixture(body.instructions === "invalid" ? '{"extra":true}' : '{"acknowledged":true}'), { headers: { "x-request-id": "req_fixture" } });
  } });
  const params: ResponseCreateParamsNonStreaming = { model: aiSupportContract.model, max_output_tokens: 64, reasoning: { effort: "none" }, tools: [], tool_choice: "none", store: false, text: { format: zodTextFormat(probeOutput, "support_probe") }, input: [{ role: "user", content: [{ type: "input_text", text: "fixture" }, { type: "input_image", detail: "low", image_url: "data:image/png;base64,fixture" }] }] };
  const parsed = await client.responses.parse(params);
  const pending = client.responses.parse({ ...params, instructions: "invalid" });
  const raw: Response = await pending.asResponse();
  const beforeParse: { usage: { total_tokens: number } } = await raw.clone().json();
  let parseRejected: boolean = false;
  try { await pending; } catch (error: unknown) { if (!(error instanceof z.ZodError)) throw error; parseRejected = true; }
  let streamEvents: number = 0;
  const stream = await client.responses.create({ ...params, stream: true });
  for await (const event of stream) { if (event.type === "response.completed") streamEvents += 1; }
  const countBefore: number = requests.length;
  try { await client.responses.parse({ ...params, instructions: "reject" }); throw new Error("429가 거부되지 않았습니다."); }
  catch (error: unknown) { if (!(error instanceof OpenAI.RateLimitError)) throw error; }
  const first: { model: string; text: { format: { strict: boolean } }; input: { content: { type: string }[] }[] } = await requests[0].clone().json();
  return { environment: "mock", model: first.model, strictFormat: first.text.format.strict, image: first.input[0].content.some((part): boolean => part.type === "input_image"), responseId: parsed.id, usageBeforeParseFailure: beforeParse.usage.total_tokens, parseRejected, streamEvents, sdkRetries: requests.length - countBefore - 1, https: requests.every((request): boolean => request.url.startsWith("https://api.openai.com/")) };
}
