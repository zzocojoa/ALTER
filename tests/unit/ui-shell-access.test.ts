import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement } from "react";
import type { OwnerDecision } from "../../lib/auth-policy";
import { AccessScreen } from "../../components/alter/access-screen";
import { AppShell } from "../../components/alter/app-shell";
import LearningLayout from "../../app/learn/layout";

const access = vi.hoisted(() => ({ read: vi.fn<() => Promise<OwnerDecision>>() }));
vi.mock("@/lib/owner-access", () => ({ getOwnerDecision: access.read }));
const child: ReactElement = createElement("p", {}, "서버 판정된 시험 본문");

describe("학습 셸 서버 경계", () => {
  beforeEach((): void => { access.read.mockReset(); });
  it("소유자 판정 후에만 셸에 본문을 전달한다", async (): Promise<void> => {
    access.read.mockResolvedValue({ kind: "owner" });
    const result = await LearningLayout({ children: child });
    expect(result.type).toBe(AppShell);
    expect(result.props).toEqual({ children: child });
  });
  it.each<OwnerDecision>([{ kind: "unauthenticated" }, { kind: "forbidden" }])("비소유자 상태에서는 기존 페이지 판정만 유지한다: $kind", async (decision): Promise<void> => {
    access.read.mockResolvedValue(decision);
    const result = await LearningLayout({ children: child });
    expect(result.type).not.toBe(AppShell);
    expect(result.props).toEqual({ children: child });
  });
  it("설정 오류는 비공개 본문과 설정 원문을 표시하지 않는다", async () => { access.read.mockResolvedValue({ kind: "configuration-error", setting: "ALTER_OWNER_USER_ID" }); const result = await LearningLayout({ children: child }); expect(result.type).toBe(AccessScreen); expect(renderToStaticMarkup(result)).not.toMatch(/서버 판정된 시험 본문|ALTER_OWNER_USER_ID/); });
  it("복원 격리 상태는 본문과 셸을 모두 대체한다", async (): Promise<void> => {
    access.read.mockResolvedValue({ kind: "restore-quarantined" });
    const result = await LearningLayout({ children: child });
    expect(result.type).toBe(AccessScreen);
    expect(renderToStaticMarkup(result)).not.toContain("서버 판정된 시험 본문");
  });
});
