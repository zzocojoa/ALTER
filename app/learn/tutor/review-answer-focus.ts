"use client";
import { useEffect, useRef } from "react";
import { useLocationFragment } from "@/lib/use-location-fragment";
import type { TutorView } from "@/lib/tutor/view";

/** 서버가 연 복습의 편집 가능한 실제 필드만 한 번 찾아 초점을 옮깁니다. */
export function useReviewAnswerFocus(view: TutorView | null, ready: boolean): void {
  const fragment: string = useLocationFragment();
  const focused = useRef<string | null>(null);
  useEffect((): (() => void) | void => {
    if (!ready || !view?.review || view.phase !== "awaiting-answer" || !["#tutor-answer", "#tutor-answer-area"].includes(fragment)) return;
    const key: string = `${view.id}:${view.question.id}`;
    if (focused.current === key || new URL(window.location.href).searchParams.get("id") !== view.id) return;
    const frame: number = window.requestAnimationFrame((): void => {
      const field = document.querySelector<HTMLTextAreaElement>("#tutor-answer-area textarea:not(:disabled)");
      if (!field || field.closest("[hidden], [inert]") || !field.checkVisibility()) return;
      field.focus({ preventScroll: true }); field.scrollIntoView({ block: "center" }); focused.current = key;
    });
    return (): void => window.cancelAnimationFrame(frame);
  }, [view, ready, fragment]);
}
