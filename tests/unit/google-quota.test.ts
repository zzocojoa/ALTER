import { describe, expect, it } from "vitest";
import { prepareGoogleQuota, requireGoogleQuotaPolicySuccessor } from "../../lib/google/quota.ts";
import { fixtureGoogleProject } from "../fixtures/google-project.ts";
import { fixtureGoogleQuota } from "../fixtures/google-quota.ts";

const now: number = Date.parse("2026-10-25T00:00:00Z");
const policy = fixtureGoogleQuota("owner", now, 100, 50);
const project = { ...fixtureGoogleProject(now), projectId: policy.projectId, consoleSource: `https://console.cloud.google.com/apis/dashboard?project=${policy.projectId}` };
describe("Google quota 실제 확인 계약", () => {
  it("프로젝트와 사용자 제한·메서드 단위를 모두 계산하고 전송 지연도 포함한다", async () => {
    const plan = await prepareGoogleQuota(policy, project, "owner", "subject", "drive.files.get", now);
    expect(plan.charges.map(item => [item.subject, item.weight, item.limit])).toEqual([["project", 5, 100], ["subject", 5, 50]]);
    expect(plan.charges[0].periodStart).toBe(now - 90_000);
    expect(plan.validUntil).toBe(now + 30_000);
  });
  it("미확인·중복·누락 차원과 비용·초기화 근거를 거부한다", async () => {
    for (const modified of [{ ...policy, validUntil: now }, { ...policy, ownerId: "other" }, { ...policy, apis: [...policy.apis, ...policy.apis] }, { ...policy, methods: [...policy.methods, ...policy.methods] }, { ...policy, methods: [] }, { ...policy, methods: policy.methods.map(item => ({ ...item, costs: item.costs.slice(0, 1) })) }, { ...policy, apis: policy.apis.map(item => ({ ...item, dimensions: item.dimensions.slice(0, 1) })) }]) await expect(prepareGoogleQuota(modified, project, "owner", "subject", "drive.files.get", now)).rejects.toThrow();
    await expect(prepareGoogleQuota(policy, project, "owner", "subject", "docs.documents.get", now)).rejects.toThrow();
  });
  it("콘솔 잔여량과 로컬 제한 중 보수적인 쪽을 사용한다", async () => {
    for (const change of [{ consoleUsedUpper: 98 }, { appLimit: 100_001 }, { consoleObservedAt: now + 1 }]) await expect(prepareGoogleQuota({ ...policy, apis: policy.apis.map(api => ({ ...api, dimensions: api.dimensions.map(dimension => ({ ...dimension, ...change })) })) }, project, "owner", "subject", "drive.files.get", now)).rejects.toThrow();
  });
  it("제공사 일일 초기화의 절대 시각을 보존하고 기간 밖 호출을 차단한다", async () => {
    const daily = { ...policy.apis[0].dimensions[0], metric: "daily-free", category: "free-budget" as const, window: { kind: "fixed" as const, periodStart: now - 1000, resetAt: now + 1000, providerReset: "America/Los_Angeles midnight verified" }, consoleWindowStart: now - 1000, consoleWindowEnd: now + 1000 };
    const limited = { ...policy, apis: [{ ...policy.apis[0], dailyFree: "limited" as const, dimensions: [...policy.apis[0].dimensions, daily] }], methods: policy.methods.map(item => ({ ...item, costs: [...item.costs, { metric: daily.metric, scope: "project" as const, units: 5 }] })) };
    expect((await prepareGoogleQuota(limited, project, "owner", "subject", "drive.files.get", now)).validUntil).toBe(now + 1000);
    await expect(prepareGoogleQuota(limited, project, "owner", "subject", "drive.files.get", now + 1000)).rejects.toThrow();
    await expect(prepareGoogleQuota({ ...policy, apis: [{ ...policy.apis[0], dailyFree: "limited" }] }, project, "owner", "subject", "drive.files.get", now)).rejects.toThrow();
  });
  it("Picker 쿼리 한도와 로컬 세션 수를 섞지 않으며 가상 프로젝트 quota를 만들지 않는다", async () => {
    const pickerPolicy = { ...policy, pickerUsage: { accounting: "browser-sessions-only" as const, projectSessionsPerMinute: 1, userSessionsPerMinute: 1, provider: { queriesPerMinutePerUser: 60, enforcement: "google" as const, measuredQueries: null, consoleSource: `https://console.cloud.google.com/apis/api/picker.googleapis.com/quotas?project=${policy.projectId}`, checkedAt: now, validUntil: now + 3_600_000 } } };
    const noBilling = { ...project, billingAccountLinked: false };
    const plan = await prepareGoogleQuota(pickerPolicy, noBilling, "owner", "subject", "picker.open", now);
    expect(plan.charges.map(item => [item.unit, item.weight, item.limit])).toEqual([["picker-session", 1, 1], ["picker-session", 1, 1]]);
    expect(plan.charges[0].periodStart).toBe(now - 120_000);
    await expect(prepareGoogleQuota(policy, noBilling, "owner", "subject", "picker.open", now)).rejects.toThrow();
    await expect(prepareGoogleQuota(pickerPolicy, { ...project, billingAccountLinked: true }, "owner", "subject", "picker.open", now)).rejects.toThrow();
    await expect(prepareGoogleQuota({ ...pickerPolicy, pickerUsage: { ...pickerPolicy.pickerUsage, provider: { ...pickerPolicy.pickerUsage.provider, validUntil: now } } }, noBilling, "owner", "subject", "picker.open", now)).rejects.toThrow();
    await expect(prepareGoogleQuota({ ...pickerPolicy, apis: [...pickerPolicy.apis, { ...pickerPolicy.apis[0], api: "picker" as const }] }, noBilling, "owner", "subject", "picker.open", now)).rejects.toThrow();
    expect(() => requireGoogleQuotaPolicySuccessor(pickerPolicy, { ...policy, version: 2 })).toThrow();
  });
  it("정책 버전이 바뀌어도 측정 키를 바꿔 사용량을 지우지 못한다", async () => {
    const next = { ...policy, version: 2 };
    expect(() => requireGoogleQuotaPolicySuccessor(policy, next)).not.toThrow();
    expect((await prepareGoogleQuota(policy, project, "owner", "subject", "drive.files.get", now)).charges.map(item => item.key)).toEqual((await prepareGoogleQuota(next, project, "owner", "subject", "drive.files.get", now)).charges.map(item => item.key));
    expect(() => requireGoogleQuotaPolicySuccessor(policy, { ...next, apis: next.apis.map(api => ({ ...api, dimensions: api.dimensions.map(item => ({ ...item, unit: "requests" as const })) })) })).toThrow();
  });
});
