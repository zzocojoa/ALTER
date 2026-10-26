import { recordId } from "../../lib/domain/contracts";
import { describe, expect, it } from "vitest";
import { featureAvailability, serviceNames, usageAvailability } from "../../lib/dashboard/availability";
import type { AvailabilityInput, FeatureName, ServiceCondition, ServiceName } from "../../lib/dashboard/availability";
import { fixtureUsageDashboard } from "../fixtures/dashboard-usage";
const ready: ServiceCondition = { state: "ready", reason: "검증 fixture" };
const blocked: ServiceCondition = { state: "blocked", reason: "장애 fixture" };
function base(): AvailabilityInput { return { services: Object.fromEntries(serviceNames.map(name => [name, ready])) as Record<ServiceName, ServiceCondition>, codeRollback: "not-requested", dataRestore: "not-requested" }; }
function states(input: AvailabilityInput): Readonly<Record<FeatureName, ServiceCondition["state"]>> { return Object.fromEntries(featureAvailability(input).map(item => [item.feature, item.state])) as Record<FeatureName, ServiceCondition["state"]>; }
describe("기능별 장애 격리", () => {
  it("복원된 잔여 예산과 새 Google 동의가 있어도 현재 대사 없이 실행 가능으로 표시하지 않는다", () => {
    const now = Date.now(); const data = fixtureUsageDashboard(now);
    const result = usageAvailability({ ...data, restoration: { runId: recordId.parse("00000000-0000-4000-8000-000000000001"), activatedAt: now, learning: "active", externalAuthority: "unverified" } }, now);
    expect(result.dataRestore).toBe("verified");
    expect(result.services.aiBudget.state).toBe("blocked");
    for (const service of ["drive", "docs", "sheets", "calendar", "picker"] as const) expect(result.services[service].state).toBe("blocked");
    expect(result.services.d1Read.state).toBe("ready"); expect(result.services.d1Write.state).toBe("verify");
  });
  it("AI 예산 소진에도 확정 Google 내보내기와 직접 답안을 허용한다", () => {
    const input = base(); const value = { ...input, services: { ...input.services, aiBudget: blocked } };
    expect(states(value)).toMatchObject({ aiText: "blocked", aiVision: "blocked", reportExport: "ready", calendarExport: "ready", answer: "ready", records: "ready" });
    expect(input.services.aiBudget).toEqual(ready);
  });
  it("Google 해제·API 한도 장애를 ChatGPT 로그인과 AI에 전파하지 않는다", () => {
    const input = base();
    expect(states({ ...input, services: { ...input.services, googleOAuth: blocked } })).toMatchObject({ reportExport: "blocked", calendarExport: "blocked", referenceImport: "blocked", aiText: "ready", answer: "ready", records: "ready" });
    expect(states({ ...input, services: { ...input.services, sheets: blocked } })).toMatchObject({ reportExport: "blocked", calendarExport: "ready", referenceImport: "ready", aiText: "ready" });
    expect(states({ ...input, services: { ...input.services, googleFiles: blocked } })).toMatchObject({ reportExport: "blocked", referenceImport: "blocked", calendarExport: "ready" });
  });
  it("R2 장애는 원본 검증이 필요한 AI·파일 기능에만 영향을 준다", () => {
    const input = base();
    expect(states({ ...input, services: { ...input.services, r2Read: blocked, r2Write: blocked } })).toMatchObject({ upload: "blocked", preview: "blocked", aiText: "blocked", aiVision: "blocked", answer: "ready", records: "ready", reportExport: "ready" });
  });
  it("D1 쓰기 실패는 저장을 차단하고 읽기와 구분하며 Sites 장애는 모두 차단한다", () => {
    const input = base();
    expect(states({ ...input, services: { ...input.services, d1Write: blocked } })).toMatchObject({ answer: "blocked", aiText: "blocked", reportExport: "blocked", records: "ready", preview: "ready" });
    expect(Object.values(states({ ...input, services: { ...input.services, sites: blocked } })).every(state => state === "blocked")).toBe(true);
    expect(Object.values(states({ ...input, services: { ...input.services, owner: blocked } })).every(state => state === "blocked")).toBe(true);
  });
  it("미확인을 허용으로 바꾸지 않고 복합 장애 원인을 모두 보관한다", () => {
    const input = base();
    const result = featureAvailability({ ...input, services: { ...input.services, d1Write: { state: "verify", reason: "쓰기 미확인" }, aiBudget: blocked, r2Read: blocked } });
    expect(result.find(item => item.feature === "aiText")?.reasons.map(item => item.service)).toEqual(["d1Write", "aiBudget", "r2Read"]);
    expect(result.find(item => item.feature === "answer")?.state).toBe("verify");
  });
  it("코드 롤백만으로 데이터 복원 상태나 비용 사용 권한을 변경하지 않는다", () => {
    const input = base(); const value: AvailabilityInput = { ...input, codeRollback: "confirmed", dataRestore: "incomplete", services: { ...input.services, aiBudget: blocked } };
    featureAvailability(value); expect(value.dataRestore).toBe("incomplete"); expect(states(value).aiText).toBe("blocked");
  });
  it("실제 표시 관측은 쓰기 성공을 추정하지 않고 오래된 상태를 다시 확인한다", () => {
    const now: number = Date.now(); const data = fixtureUsageDashboard(now);
    const result = usageAvailability(data, now);
    expect(result.services.d1Write.state).toBe("verify"); expect(result.services.owner.state).toBe("ready"); expect(result.services.googleOAuth.state).toBe("blocked");
    expect(Object.values(usageAvailability(data, now + 60_000).services).every(item => item.state === "verify")).toBe(true);
    const exhausted = { ...data, ai: { ...data.ai, probeCommittedUsdMicros: 50_000 } };
    expect(usageAvailability(exhausted, now).services.aiBudget.state).toBe("blocked");
  });
});
