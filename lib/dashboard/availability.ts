import { z } from "zod";
import type { UsageDashboard } from "./usage.ts";
import { dashboardIsStale } from "./contracts.ts";
import { requireDispatchPricing } from "../ai/pricing.ts";

export const serviceNames = ["owner", "sites", "d1Read", "d1Write", "r2Read", "r2Write", "materialCapacity", "aiBudget", "googleOAuth", "googleFiles", "googleCalendar", "googleStorage", "drive", "docs", "sheets", "calendar", "picker"] as const;
export type ServiceName = typeof serviceNames[number];
export const serviceCondition = z.object({ state: z.enum(["ready", "blocked", "verify"]), reason: z.string().min(1) }).strict();
export type ServiceCondition = Readonly<z.infer<typeof serviceCondition>>;
export type AvailabilityInput = Readonly<{ services: Readonly<Record<ServiceName, ServiceCondition>>; codeRollback: "not-requested" | "confirmed" | "unknown"; dataRestore: "not-requested" | "verified" | "incomplete" | "unknown" }>;
const requirements = {
  records: ["owner", "sites", "d1Read"],
  answer: ["owner", "sites", "d1Read", "d1Write"],
  aiText: ["owner", "sites", "d1Read", "d1Write", "aiBudget", "r2Read"],
  aiVision: ["owner", "sites", "d1Read", "d1Write", "aiBudget", "r2Read"],
  upload: ["owner", "sites", "d1Read", "d1Write", "r2Write", "materialCapacity"],
  preview: ["owner", "sites", "d1Read", "r2Read"],
  reportExport: ["owner", "sites", "d1Read", "d1Write", "googleOAuth", "googleFiles", "googleStorage", "drive", "docs", "sheets"],
  calendarExport: ["owner", "sites", "d1Read", "d1Write", "googleOAuth", "googleCalendar", "googleStorage", "calendar"],
  referenceImport: ["owner", "sites", "d1Read", "d1Write", "googleOAuth", "googleFiles", "googleStorage", "drive", "picker", "r2Write", "materialCapacity"],
} as const satisfies Readonly<Record<string, readonly ServiceName[]>>;
export type FeatureName = keyof typeof requirements;
export type FeatureAvailability = Readonly<{ feature: FeatureName; state: ServiceCondition["state"]; reasons: readonly Readonly<{ service: ServiceName; reason: string; state: ServiceCondition["state"] }>[] }>;

/** 각 기능이 실제로 쓰는 서비스만 확인하며 모델·권한·원장이나 요청 상태를 변경하지 않습니다. */
export function featureAvailability(input: AvailabilityInput): readonly FeatureAvailability[] {
  return (Object.keys(requirements) as FeatureName[]).map(feature => {
    const conditions = requirements[feature].map(service => ({ service, ...input.services[service] }));
    const reasons = conditions.filter(item => item.state !== "ready");
    return { feature, state: reasons.some(item => item.state === "blocked") ? "blocked" : reasons.length > 0 ? "verify" : "ready", reasons };
  });
}
function aiCondition(data: UsageDashboard, now: number): ServiceCondition {
  if (data.restoration !== null) return { state: "blocked", reason: "복원 후 현재 예산·예약액 미확인. 과거 원장으로 AI 호출을 허용하지 않아요." };
  const ai = data.ai; const funding = ai.funding;
  if (ai.windows.some(window => window.category === "ai" && window.remaining === 0)) return { state: "blocked", reason: "이번 달 AI 예산을 모두 사용하거나 예약했어요." };
  if (funding?.probeLimitUsdMicros !== null && funding?.probeLimitUsdMicros !== undefined && ai.probeCommittedUsdMicros >= funding.probeLimitUsdMicros) return { state: "blocked", reason: "승인된 누적 검증 상한에 도달했어요. 재시도도 포함해요." };
  if (ai.configuration !== "configured" || !ai.pricing || !funding || !funding.current) return { state: "verify", reason: "AI 설정·가격·결제 근거를 다시 확인해야 해요." };
  try { requireDispatchPricing(ai.pricing, now); } catch (error: unknown) { if (!(error instanceof Error) || error.name !== "PricingFailure") throw error; return { state: "verify", reason: "가격·환산 근거의 확인 기간을 다시 확인해야 해요." }; }
  if (funding.probeLimitUsdMicros !== null) return { state: "verify", reason: "승인된 고정 시험 입력만 누적 상한 안에서 실행할 수 있어요. 일반 자료는 별도 승인이 필요해요." };
  return { state: "verify", reason: "요청별 비용 상한·승인 범위·잔액을 실행 전에 확인해요. 자동 충전은 하지 않아요." };
}
function googleCondition(data: UsageDashboard, api: "drive" | "docs" | "sheets" | "calendar" | "picker"): ServiceCondition {
  if (data.restoration !== null) return { state: "blocked", reason: "복원 후 현재 사용량·외부 반영 대사 필요. 재동의만으로 기존 작업을 재실행하지 않아요." };
  const block = data.google.blocks.find(item => item.api === api);
  if (block) return { state: "blocked", reason: `${api}: 저장된 제공사 제한 ${block.reason}` };
  if (api === "picker") {
    const entries = data.google.pickerLimits;
    if (entries.some(item => item.current && (item.projectCharged >= item.projectSessionsPerMinute || item.userCharged !== null && item.userCharged >= item.userSessionsPerMinute))) return { state: "blocked", reason: "Picker 앱 열기 세션 제한에 도달했어요." };
    return { state: "verify", reason: "Picker 세션·Google 실제 쿼리 제한은 파일 선택 전에 다시 확인해요." };
  }
  const limits = data.google.limits.filter(item => item.api === api);
  if (limits.some(item => item.current && item.appCharged !== null && item.appCharged + item.consoleUpper >= item.appLimit)) return { state: "blocked", reason: `${api}: 앱 집계와 콘솔 관측이 제한에 도달했어요.` };
  return { state: "verify", reason: `${api}: 메서드별 예약량·무료 조건을 실행 전에 다시 확인해요.` };
}
/** 저장된 관측은 실행 허가가 아닙니다. 쓰기·제공사 접근의 미확인을 정상으로 추정하지 않습니다. */
export function usageAvailability(data: UsageDashboard, now: number): AvailabilityInput {
  const connection = data.google.connection; const material = data.platform.material; const storage = data.google.storage;
  const fresh = !dashboardIsStale(data.asOf, now);
  const local: ServiceCondition = { state: fresh ? "ready" : "verify", reason: fresh ? "이번 조회의 소유자 인증과 원장 읽기를 확인했어요." : "이전 조회 결과예요. 현재 상태를 다시 읽어 주세요." };
  const services: Record<ServiceName, ServiceCondition> = {
    owner: local, sites: local, d1Read: local,
    d1Write: { state: "verify", reason: "저장 요청이 성공한 경우에만 완료로 표시해요. 쓰기 가능 여부를 조회로 대신하지 않아요." },
    r2Read: { state: "verify", reason: "원본을 열 때 파일 접근 권한과 저장소 응답을 확인해요." },
    r2Write: { state: "verify", reason: "전송·크기·체크섬 검증이 끝나야 파일 등록이 완료돼요." },
    materialCapacity: material === null ? { state: "verify", reason: "ALTER 저장 용량의 실측 근거가 없어요." } : material.blocked || material.occupiedBytes + material.reservedBytes >= material.limitBytes ? { state: "blocked", reason: "ALTER 저장 용량 또는 실측 검증 때문에 새 등록이 제한돼요." } : { state: "ready", reason: "저장된 앱 용량 검증 기간 내예요. 파일별 크기는 등록 시 확인해요." },
    aiBudget: aiCondition(data, now),
    googleOAuth: !connection || !["active", "partial"].includes(connection.state) ? { state: "blocked", reason: "Google 연결·재동의를 확인해 주세요. ChatGPT 소유자 로그인은 별도예요." } : { state: "verify", reason: "Google 권한과 토큰 유효성을 요청별로 확인해요." },
    googleFiles: { state: connection?.filesAllowed ? "ready" : "blocked", reason: "선택·생성한 Google 파일 권한이 필요해요." },
    googleCalendar: { state: connection?.calendarAllowed ? "ready" : "blocked", reason: "ALTER가 만든 캘린더 권한이 필요해요." },
    googleStorage: !storage || !storage.current ? { state: "verify", reason: "Google 계정 저장 공간의 최신 근거가 필요해요." } : BigInt(storage.usedBytes) + BigInt(storage.reservedBytes) >= BigInt(storage.limitBytes) ? { state: "blocked", reason: "Google 계정 저장 공간이 예약분을 포함해 가득 찼어요." } : { state: "ready", reason: "Google 계정 저장 공간 관측 기간 내예요." },
    drive: googleCondition(data, "drive"), docs: googleCondition(data, "docs"), sheets: googleCondition(data, "sheets"), calendar: googleCondition(data, "calendar"), picker: googleCondition(data, "picker"),
  };
  return { services: fresh ? services : Object.fromEntries(serviceNames.map(name => [name, { state: "verify", reason: "관측이 오래되어 현재 상태를 다시 읽어야 해요." }])) as Record<ServiceName, ServiceCondition>, codeRollback: "unknown", dataRestore: data.restoration === null ? "unknown" : data.restoration.learning === "active" ? "verified" : "incomplete" };
}
