"use client";

import { useSyncExternalStore, type ReactElement, type ReactNode } from "react";
import { z } from "zod";
import { ManualTabs, RetainedTabPanel } from "@/components/alter/tabs";
import "./original.css";

export type ComparisonPane = "source" | "result";

function subscribeWidth(listener: () => void): () => void {
  const query: MediaQueryList = window.matchMedia("(min-width: 1024px)");
  query.addEventListener("change", listener);
  return (): void => query.removeEventListener("change", listener);
}
function wideSnapshot(): boolean { return window.matchMedia("(min-width: 1024px)").matches; }
function serverSnapshot(): boolean { return false; }

/** 패널의 위치와 보임만 바꾸며 같은 입력 소유자를 회전·탭 전환 중에도 유지합니다. */
export function OriginalComparison({ source, result, pane, onPaneChange }: Readonly<{ source: ReactNode; result: ReactNode; pane: ComparisonPane; onPaneChange: (pane: ComparisonPane) => void }>): ReactElement {
  const wide: boolean = useSyncExternalStore(subscribeWidth, wideSnapshot, serverSnapshot);
  return <div className="alter-original-comparison" data-wide={wide}>
    <ManualTabs label="원본과 추출 결과" value={pane} onValueChange={(value): void => onPaneChange(z.enum(["source", "result"]).parse(value))} choices={[{ value: "source", label: "원본 보기", unavailableReason: null }, { value: "result", label: "추출 결과 보기", unavailableReason: null }]}>
      <div className="alter-comparison-panels">
        <RetainedTabPanel value="source" selectedValue={wide ? "source" : pane}><h4 className="alter-label">선택 페이지의 원본</h4>{source}</RetainedTabPanel>
        <RetainedTabPanel value="result" selectedValue={wide ? "result" : pane}>{result}</RetainedTabPanel>
      </div>
    </ManualTabs>
  </div>;
}
