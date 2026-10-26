import { z } from "zod";
import { contentHash, money, policy, recordId, timestamp } from "../domain/contracts.ts";
import type { Money } from "../domain/contracts.ts";
import { aiSupportContract } from "./support.ts";

const decimal = z.string().max(40).regex(/^(0|[1-9]\d{0,17})(\.\d{1,12})?$/);
const positiveDecimal = decimal.refine((value): boolean => /[1-9]/.test(value));
const tokenCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const provenance = z.object({ source: z.string().url(), checkedAt: timestamp, validFrom: timestamp, validUntil: timestamp, evidence: z.enum(["verified", "fixture", "budget-policy"]) }).strict().refine((value): boolean => value.validUntil > value.validFrom && value.checkedAt < value.validUntil);
const rates = z.object({ input: positiveDecimal, cachedInput: positiveDecimal, cacheWrite30m: positiveDecimal, cacheWrite12h: positiveDecimal, output: positiveDecimal }).strict();
export const pricingVersion = z.object({
  purpose: z.literal("prepaid-probe").optional(),
  id: recordId, model: z.literal(policy.model), currency: z.literal("USD"), tokenPriceUnit: z.literal(1_000_000),
  pricing: z.object({ provenance, short: rates, long: rates, longContextThreshold: z.literal(aiSupportContract.longContextThreshold) }).strict(),
  exchange: z.object({ provenance, quote: z.literal("KRW/USD"), krwPerUsd: positiveDecimal }).strict(),
  tax: z.object({ provenance, multiplier: positiveDecimal }).strict(),
  fee: z.object({ provenance, multiplier: positiveDecimal }).strict(),
}).strict();
export type PricingVersion = Readonly<z.infer<typeof pricingVersion>>;
export const tokenUsage = z.object({ inputTokens: tokenCount, cachedInputTokens: tokenCount, cacheWriteTokens: tokenCount, cacheWriteTtl: z.enum(["30m", "12h"]), outputTokens: tokenCount, reasoningTokens: tokenCount, totalTokens: tokenCount }).strict().refine((value): boolean => [value.inputTokens, value.cachedInputTokens, value.cacheWriteTokens, value.outputTokens, value.reasoningTokens, value.totalTokens].every(Number.isSafeInteger) && BigInt(value.inputTokens) + BigInt(value.outputTokens) === BigInt(value.totalTokens) && BigInt(value.cachedInputTokens) + BigInt(value.cacheWriteTokens) <= BigInt(value.inputTokens) && value.reasoningTokens <= value.outputTokens);
export type TokenUsage = Readonly<z.infer<typeof tokenUsage>>;
type Fraction = Readonly<{ numerator: bigint; denominator: bigint }>;
export type PricedMoney = Money & Readonly<{ kind: "reservation-estimate" | "usage-calculated"; pricingVersionId: string; exactUsd: Readonly<{ numerator: string; denominator: string }> }>;
export type PricingFailure = Error & Readonly<{ code: "ai_pricing_invalid"; field: string }>;

function invalid(field: string): never { throw Object.assign(new Error("비용 설정 또는 계산 범위를 확인해야 합니다."), { name: "PricingFailure", code: "ai_pricing_invalid", field }); }
function fraction(value: string): Fraction {
  decimal.parse(value);
  const parts: string[] = value.split(".");
  const places: number = parts[1]?.length ?? 0;
  return { numerator: BigInt(parts.join("")), denominator: BigInt(10) ** BigInt(places) };
}
function multiply(left: Fraction, right: Fraction): Fraction { return { numerator: left.numerator * right.numerator, denominator: left.denominator * right.denominator }; }
function add(left: Fraction, right: Fraction): Fraction { return { numerator: left.numerator * right.denominator + right.numerator * left.denominator, denominator: left.denominator * right.denominator }; }
function scaleRate(count: number, price: string): Fraction { return multiply(fraction(price), { numerator: BigInt(count), denominator: BigInt(1_000_000) }); }
function maximum(values: readonly string[]): string {
  if (values.length === 0) invalid("rates");
  return values.reduce((highest: string, current: string): string => {
    const left: Fraction = fraction(highest); const right: Fraction = fraction(current);
    return left.numerator * right.denominator >= right.numerator * left.denominator ? highest : current;
  });
}

/** 적용 시점은 예약 시각으로 고정하고 나중에 재계산할 때도 저장한 버전만 사용합니다. */
export function requirePricingAt(value: PricingVersion, occurredAt: number): PricingVersion {
  timestamp.parse(occurredAt);
  const validated: PricingVersion = pricingVersion.parse(value);
  for (const [field, source] of Object.entries({ pricing: validated.pricing.provenance, exchange: validated.exchange.provenance, tax: validated.tax.provenance, fee: validated.fee.provenance })) {
    if (source.validFrom > occurredAt || source.validUntil <= occurredAt || source.checkedAt > occurredAt) invalid(field);
  }
  for (const [field, multiplier] of Object.entries({ tax: validated.tax.multiplier, fee: validated.fee.multiplier })) {
    const rate: Fraction = fraction(multiplier); if (rate.numerator < rate.denominator) invalid(field);
  }
  return validated;
}

/** 실제 전송은 확인된 설정만 허용하며 테스트 가격을 운영 가격으로 사용하지 않습니다. */
export function requireVerifiedPricing(value: PricingVersion, occurredAt: number): PricingVersion {
  const validated: PricingVersion = requirePricingAt(value, occurredAt);
  if (validated.purpose || [validated.pricing, validated.exchange, validated.tax, validated.fee].some((item): boolean => item.provenance.evidence !== "verified")) invalid("evidence");
  return validated;
}

/** 미확정 원화는 실제 환율로 표시하지 않고 고정 예산 계수로만 계산합니다. 달러 상한은 별도 원장에서 강제합니다. */
export function requireDispatchPricing(value: PricingVersion, occurredAt: number): PricingVersion {
  if (!value.purpose) return requireVerifiedPricing(value, occurredAt);
  const validated: PricingVersion = requirePricingAt(value, occurredAt);
  if (validated.pricing.provenance.evidence !== "verified" || [validated.exchange, validated.tax, validated.fee].some((item): boolean => item.provenance.evidence !== "budget-policy") || validated.exchange.krwPerUsd !== "2000" || validated.tax.multiplier !== "1" || validated.fee.multiplier !== "1") invalid("probe-policy");
  return validated;
}

/** 유리수 달러 상한을 마이크로달러로 올림하여 정수 원장에 기록합니다. */
export function usdReservationMicros(amount: PricedMoney): number {
  const numerator: bigint = BigInt(amount.exactUsd.numerator);
  const denominator: bigint = BigInt(amount.exactUsd.denominator);
  if (numerator < BigInt(0) || denominator <= BigInt(0)) invalid("usd-bound");
  const result: bigint = (numerator * BigInt(1_000_000) + denominator - BigInt(1)) / denominator;
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) invalid("usd-bound");
  return Number(result);
}

export async function pricingFingerprint(value: PricingVersion): Promise<string> { return contentHash(pricingVersion.parse(value)); }

function convertUsd(usd: Fraction, settings: PricingVersion, kind: PricedMoney["kind"]): PricedMoney {
  const converted: Fraction = [settings.exchange.krwPerUsd, settings.tax.multiplier, settings.fee.multiplier].reduce((amount: Fraction, multiplier: string): Fraction => multiply(amount, fraction(multiplier)), usd);
  const scaled: bigint = converted.numerator * BigInt(policy.moneyScale);
  const rounded: bigint = (scaled + converted.denominator - BigInt(1)) / converted.denominator;
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) invalid("money.safe-integer");
  return { ...money.parse({ currency: "KRW", units: Number(rounded), scale: policy.moneyScale }), kind, pricingVersionId: settings.id, exactUsd: { numerator: usd.numerator.toString(), denominator: usd.denominator.toString() } };
}

/** 입력·캐시 읽기·쓰기를 배타적으로 세고 추론은 출력에 포함된 수량으로 계산합니다. */
export function calculateUsageCost(value: TokenUsage, settings: PricingVersion, occurredAt: number): PricedMoney {
  const usage: TokenUsage = tokenUsage.parse(value);
  const validated: PricingVersion = requirePricingAt(settings, occurredAt);
  const selected: z.infer<typeof rates> = usage.inputTokens > validated.pricing.longContextThreshold ? validated.pricing.long : validated.pricing.short;
  const ordinary: number = usage.inputTokens - usage.cachedInputTokens - usage.cacheWriteTokens;
  const amount: Fraction = [scaleRate(ordinary, selected.input), scaleRate(usage.cachedInputTokens, selected.cachedInput), scaleRate(usage.cacheWriteTokens, usage.cacheWriteTtl === "30m" ? selected.cacheWrite30m : selected.cacheWrite12h), scaleRate(usage.outputTokens, selected.output)].reduce(add);
  return convertUsd(amount, validated, "usage-calculated");
}

/** 캐시 할인을 가정하지 않으며 입력은 가장 높은 단가, 출력은 추론을 포함한 상한으로 예약합니다. */
export function calculateTokenReservation(inputBound: number, outputBound: number, settings: PricingVersion, occurredAt: number): PricedMoney {
  tokenCount.parse(inputBound); tokenCount.parse(outputBound);
  if (inputBound > aiSupportContract.maximumInputTokens || outputBound < 16 || outputBound > aiSupportContract.maximumOutputTokens) invalid("token-bound");
  const validated: PricingVersion = requirePricingAt(settings, occurredAt);
  const applicable: readonly z.infer<typeof rates>[] = inputBound > validated.pricing.longContextThreshold ? [validated.pricing.short, validated.pricing.long] : [validated.pricing.short];
  const inputPrice: string = maximum(applicable.flatMap((item): string[] => [item.input, item.cachedInput, item.cacheWrite30m, item.cacheWrite12h]));
  const outputPrice: string = maximum(applicable.map((item): string => item.output));
  const cost: Fraction = add(scaleRate(inputBound, inputPrice), scaleRate(outputBound, outputPrice));
  return convertUsd(cost, validated, "reservation-estimate");
}

export function calculateUsdAmount(usd: string, settings: PricingVersion, occurredAt: number): Money {
  const result: PricedMoney = convertUsd(fraction(usd), requirePricingAt(settings, occurredAt), "usage-calculated");
  return { currency: result.currency, units: result.units, scale: result.scale };
}
