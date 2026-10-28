"use client";

import type { ReactElement } from "react";
import { useLocationFragment } from "@/lib/use-location-fragment";
import { UsageDisclosure } from "./usage-disclosure";

/** 저장된 비용·휴대폰 확인 링크는 유지하며 일반 홈에는 진단 도구를 마운트하지 않습니다. */
export function HomeCheckCompatibility(): ReactElement | null {
  const fragment: string = useLocationFragment();
  if (fragment === "#check-budget") return <UsageDisclosure />;
  if (fragment === "#check-navigation" || fragment === "#check-progress" || !fragment.startsWith("#check-")) return null;
  return <section className="alter-state" aria-label="기존 확인 링크 안내"><h2 className="alter-subheading">확인 화면을 선택해 주세요</h2><p>이 주소의 확인 항목을 오늘 화면에서 찾지 못했어요. 기능 검사 도구는 소유자 진단에 모았어요.</p><a className="alter-link" href="/learn/diagnostics">소유자 진단 열기</a><a className="alter-link" href="/learn/materials">자료 원본 확인하기</a></section>;
}
