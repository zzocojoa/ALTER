"use client";
import { useLocationFragment } from "@/lib/use-location-fragment";
import { useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { clientReady, serverReady, subscribeToHydration } from "@/lib/client-ready";
import { UsageDashboardClient } from "./usage-client";
/** 초기 연결 전에 열린 details 속성과 서버 HTML이 충돌하지 않도록 준비 뒤 조작을 허용합니다. */
export function UsageDisclosure(): ReactElement {
  const ready = useSyncExternalStore(subscribeToHydration, clientReady, serverReady);
  const fragment = useLocationFragment();
  return <details open={fragment === "#check-budget" ? true : undefined} className="usage-disclosure" inert={!ready}><summary>사용량·연결 상태 확인</summary><UsageDashboardClient/></details>;
}
