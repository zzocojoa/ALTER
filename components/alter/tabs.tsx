"use client";

import { useId, type ReactElement, type ReactNode } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export type TabChoice = Readonly<{ value: string; label: string; unavailableReason: string | null }>;
type PanelProps = Readonly<{ value: string; children: ReactNode }>;
export type ManualTabsProps = Readonly<{ value: string; onValueChange: (value: string) => void; label: string; choices: readonly TabChoice[]; children: ReactNode }>;

/** 방향키는 초점만 옮깁니다. 느린 원본 패널도 Enter·Space로 명시적으로 엽니다. */
export function ManualTabs({ value, onValueChange, label, choices, children }: ManualTabsProps): ReactElement {
  const id: string = useId();
  return <Tabs value={value} onValueChange={onValueChange} orientation="horizontal" activationMode="manual" className="alter-tabs">
    <TabsList aria-label={label} variant="line" className="alter-tab-list">
      {choices.map((choice, index): ReactElement => <TabsTrigger key={choice.value} type="button" value={choice.value} disabled={choice.unavailableReason !== null} aria-describedby={choice.unavailableReason === null ? undefined : id + "-reason-" + index} className="alter-control alter-tab">{choice.label}</TabsTrigger>)}
    </TabsList>
    {choices.map((choice, index): ReactElement | null => choice.unavailableReason === null ? null : <p key={choice.value} id={id + "-reason-" + index} className="alter-caption">{choice.label}: {choice.unavailableReason}</p>)}
    {children}
  </Tabs>;
}

/** 원본처럼 선택 시에만 필요한 패널은 비선택 상태에서 자식을 유지하지 않습니다. */
export function SelectedTabPanel({ value, children }: PanelProps): ReactElement {
  return <TabsContent value={value} className="alter-tab-panel alter-focus">{children}</TabsContent>;
}

/** 입력 수명만 보존합니다. 자료·정답의 인출 가림과 권한 검사는 호출자가 별도로 적용합니다. */
export function RetainedTabPanel({ value, selectedValue, children }: PanelProps & Readonly<{ selectedValue: string }>): ReactElement {
  const inactive: boolean = value !== selectedValue;
  return <TabsContent value={value} forceMount hidden={inactive} inert={inactive} tabIndex={inactive ? -1 : 0} className="alter-tab-panel alter-focus">{children}</TabsContent>;
}
