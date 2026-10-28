"use client";

import type { ComponentProps, ReactElement } from "react";
import { Button } from "@/components/ui/button";

export type ActionAvailability = Readonly<{ kind: "available" }> | Readonly<{ kind: "busy" | "blocked"; reason: string }>;
export type ActionButtonProps = Readonly<Omit<ComponentProps<typeof Button>, "id" | "type" | "disabled" | "aria-busy" | "aria-describedby" | "variant" | "size" | "asChild" | "className"> & {
  id: string;
  type: "button" | "submit";
  availability: ActionAvailability;
  tone: "primary" | "secondary" | "danger";
}>;

/** 저장·AI 실행 여부는 기존 호출자가 결정하고 이 컴포넌트는 가능 상태만 표시합니다. */
export function ActionButton({ id, type, availability, tone, children, ...props }: ActionButtonProps): ReactElement {
  const reason: string | null = availability.kind === "available" ? null : availability.reason;
  if (reason !== null && reason.trim().length === 0) throw new TypeError("비활성 동작에는 사용자에게 표시할 이유가 필요합니다: " + id);
  const reasonId: string = id + "--reason";
  return <span className="alter-action">
    <Button {...props} id={id} type={type} variant="default" size="default" asChild={false} className="alter-control alter-button" data-tone={tone} disabled={availability.kind !== "available"} aria-busy={availability.kind === "busy"} aria-describedby={reason === null ? undefined : reasonId}>{children}</Button>
    {reason === null ? null : <span id={reasonId} className="alter-caption alter-action-reason">{reason}</span>}
  </span>;
}
