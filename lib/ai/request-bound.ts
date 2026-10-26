import { editorFeedbackTextFormat,editorRevisionTextFormat } from "../editor/output-format.ts";
import { z } from "zod";
import type { InputTokenCountParams } from "openai/resources/responses/input-tokens";
import type { ResponseCreateParamsNonStreaming, ResponseCreateParamsStreaming } from "openai/resources/responses/responses";
import { contentHash, recordId, timestamp } from "../domain/contracts.ts";
import { formatForKind } from "./learning-contract.ts";
import { aiSupportContract } from "./support.ts";
import { calculateTokenReservation, pricingFingerprint } from "./pricing.ts";
import type { PricedMoney, PricingVersion } from "./pricing.ts";

const inputText = z.object({ type: z.literal("input_text"), text: z.string().min(1).max(200_000) }).strict();
const inputImage = z.object({ type: z.literal("input_image"), sourceRefId: recordId, dataUrl: z.string().max(2_800_000).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/), width: z.number().int().min(1).max(8192), height: z.number().int().min(1).max(8192), bytes: z.number().int().min(1).max(2_097_152), detail: z.enum(["low", "high"]) }).strict();
const message = z.object({ role: z.enum(["user", "assistant"]), content: z.array(z.discriminatedUnion("type", [inputText, inputImage])).min(1).max(20) }).strict();
export const modelRequest = z.object({ editorDraftText:z.string().max(60000).optional(), responseContract: z.enum(["weekly-review", "page-vision", "advisor-turn", "advisor-plan", "librarian-evaluation","tutor-lesson","tutor-diagnosis","tutor-scaffold","tutor-variation","editor-draft-feedback","editor-revision-review"]).optional(), instructions: z.string().min(1).max(40_000), messages: z.array(message).min(1).max(100), maximumOutputTokens: z.number().int().min(16).max(aiSupportContract.maximumOutputTokens), reasoningEffort: z.enum(["none", "low", "medium", "high", "xhigh", "max"]) }).strict();
export type ModelRequest = Readonly<z.infer<typeof modelRequest>>;
export type InputImage = Readonly<z.infer<typeof inputImage>>;
export type PreparedAiRequest = Readonly<{ request: ModelRequest; body: ResponseCreateParamsNonStreaming | ResponseCreateParamsStreaming; imageCount: number; imageBytes: number; requestFingerprint: string }>;
export const countEvidence = z.object({ requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/), model: z.literal(aiSupportContract.model), inputTokens: z.number().int().nonnegative().max(aiSupportContract.maximumInputTokens), providerRequestId: z.string().min(1).max(200), checkedAt: timestamp }).strict();
export type CountEvidence = Readonly<z.infer<typeof countEvidence>>;
export type RequestBound = Readonly<{ requestFingerprint: string; pricingFingerprint: string; countRequestId: string; inputTokenBound: number; outputTokenBound: number; reasoningIncluded: true; imageCount: number; imageBytes: number; amount: PricedMoney; computedAt: number }>;
export type RequestBoundFailure = Error & Readonly<{ code: "ai_bound_unavailable"; field: string }>;
function fail(field: string): never { throw Object.assign(new Error("동일한 요청의 전체 과금 상한을 확인할 수 없습니다."), { name: "RequestBoundFailure", code: "ai_bound_unavailable", field }); }

function imageByteCount(image: InputImage): number {
  const base64: string = image.dataUrl.slice(image.dataUrl.indexOf(",") + 1);
  if (base64.length % 4 !== 0) fail("image.base64");
  const bytes: number = base64.length * 3 / 4 - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
  if (bytes !== image.bytes) fail("image.bytes");
  return bytes;
}

/** 서버가 승인한 자료를 받아 외부 URL·실행 도구·숨겨진 대화 상태를 제외한 전송 본문을 만듭니다. */
export async function prepareAiRequest(value: ModelRequest): Promise<PreparedAiRequest> {
  const request: ModelRequest = modelRequest.parse(value);
  const images: InputImage[] = request.messages.flatMap((item): InputImage[] => item.content.filter((part): part is z.infer<typeof inputImage> => part.type === "input_image"));
  const imageBytes: number = images.reduce((total: number, item: InputImage): number => total + imageByteCount(item), 0);
  if (images.length > 4 || imageBytes > 4_194_304) fail("image.request-limit");
  const body: ResponseCreateParamsNonStreaming = {
    model: aiSupportContract.model, instructions: request.instructions,
    input: request.messages.map((item) => ({ role: item.role, content: item.content.map((part) => part.type === "input_text" ? { type: "input_text" as const, text: part.text } : { type: "input_image" as const, image_url: part.dataUrl, detail: part.detail }) })),
    text: { format: request.editorDraftText!==undefined && request.responseContract==="editor-draft-feedback" ? editorFeedbackTextFormat(request.editorDraftText) : request.editorDraftText!==undefined && request.responseContract==="editor-revision-review" ? editorRevisionTextFormat(request.editorDraftText) : formatForKind(request.responseContract) }, reasoning: { effort: request.reasoningEffort }, max_output_tokens: request.maximumOutputTokens,
    tools: [], tool_choice: "none", service_tier: "default", prompt_cache_options: { mode: "explicit", ttl: "30m" },
    truncation: "disabled", background: false, store: true, stream: false,
  };
  const bytes: number = new TextEncoder().encode(JSON.stringify(body)).byteLength;
  if (bytes > 8_388_608) fail("request.bytes");
  return { request, body, imageCount: images.length, imageBytes, requestFingerprint: await contentHash({ request, body }) };
}

/** 스트리밍도 전송 방식을 포함한 별도 지문으로 예약하여 비스트림 요청과 혼용하지 않습니다. */
export async function prepareAiStreamingRequest(value: ModelRequest): Promise<PreparedAiRequest> {
  const prepared: PreparedAiRequest = await prepareAiRequest(value);
  const body: ResponseCreateParamsStreaming = { ...prepared.body, stream: true };
  return { ...prepared, body, requestFingerprint: await contentHash({ request: prepared.request, body }) };
}

/** 모델·지시문·대화·이미지·출력 스키마를 생성 요청과 동일한 내용으로 집계합니다. */
export function tokenCountPayload(prepared: PreparedAiRequest): InputTokenCountParams {
  return { model: prepared.body.model, instructions: prepared.body.instructions, input: prepared.body.input, text: prepared.body.text, reasoning: prepared.body.reasoning, tools: [], tool_choice: "none", truncation: "disabled" };
}

/** 집계할 수 없으면 이미지 패치 계수나 글자 수로 대신 계산하지 않습니다. */
export async function calculateRequestBound(prepared: PreparedAiRequest, evidence: CountEvidence, settings: PricingVersion, now: number): Promise<RequestBound> {
  timestamp.parse(now);
  const verified: CountEvidence = countEvidence.parse(evidence);
  const rebuilt: PreparedAiRequest = await prepareAiRequest(prepared.request);
  if (await contentHash({ request: rebuilt.request, body: { ...rebuilt.body, stream: prepared.body.stream } }) !== prepared.requestFingerprint || await contentHash({ request: prepared.request, body: prepared.body }) !== prepared.requestFingerprint || verified.requestFingerprint !== prepared.requestFingerprint) fail("request.fingerprint");
  if (verified.checkedAt > now || now - verified.checkedAt > 300_000) fail("token-count.expired");
  return { requestFingerprint: prepared.requestFingerprint, pricingFingerprint: await pricingFingerprint(settings), countRequestId: verified.providerRequestId, inputTokenBound: verified.inputTokens, outputTokenBound: prepared.request.maximumOutputTokens, reasoningIncluded: true, imageCount: rebuilt.imageCount, imageBytes: rebuilt.imageBytes, amount: calculateTokenReservation(verified.inputTokens, prepared.request.maximumOutputTokens, settings, now), computedAt: now };
}

export async function verifyRequestBound(prepared: PreparedAiRequest, bound: RequestBound, settings: PricingVersion): Promise<void> {
  const expected: PricedMoney = calculateTokenReservation(bound.inputTokenBound, bound.outputTokenBound, settings, bound.computedAt);
  if (bound.amount.exactUsd.numerator !== expected.exactUsd.numerator || bound.amount.exactUsd.denominator !== expected.exactUsd.denominator || bound.amount.units !== expected.units || bound.amount.pricingVersionId !== expected.pricingVersionId || bound.amount.kind !== "reservation-estimate") fail("reservation.amount");
  if (bound.requestFingerprint !== prepared.requestFingerprint || await contentHash({ request: prepared.request, body: prepared.body }) !== bound.requestFingerprint || bound.pricingFingerprint !== await pricingFingerprint(settings) || bound.outputTokenBound !== prepared.request.maximumOutputTokens) fail("reservation.fingerprint");
}

export function exceedsReservation(actual: PricedMoney, bound: RequestBound): boolean {
  if (actual.pricingVersionId !== bound.amount.pricingVersionId || actual.currency !== bound.amount.currency || actual.scale !== bound.amount.scale) fail("settlement.version");
  return actual.units > bound.amount.units;
}
