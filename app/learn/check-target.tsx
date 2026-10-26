"use client";
import { useLocationFragment } from "@/lib/use-location-fragment";
import { useEffect, useRef } from "react";
import type { ReactElement, ReactNode } from "react";
import "./check-target.css";
/** 비동기 내용이 준비된 뒤에도 확인 링크의 위치와 키보드 초점을 함께 맞춥니다. */
export function CheckTarget({ id, instruction, children }: Readonly<{ id: string; instruction: string; children: ReactNode }>): ReactElement {
  const fragment = useLocationFragment();
  const target = useRef<HTMLElement>(null);
  useEffect(() => {
    let frame: number | null = null;
    function locate(): void {
      if (window.location.hash !== `#${id}`) return;
      frame = window.requestAnimationFrame(() => {
        target.current?.focus({ preventScroll: true });
        target.current?.scrollIntoView({ block: "start", behavior: "instant" });
      });
    }
    locate(); window.addEventListener("hashchange", locate);
    return () => { if (frame !== null) window.cancelAnimationFrame(frame); window.removeEventListener("hashchange", locate); };
  }, [id, fragment]);
  return <section id={id} ref={target} tabIndex={-1} className="check-target" data-current={fragment === `#${id}`} aria-label={instruction}><p className="check-target-instruction"><strong>지금 확인할 곳</strong><br/>{instruction}</p>{children}</section>;
}
