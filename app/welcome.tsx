"use client";
import { useState, useSyncExternalStore } from "react";
import type { FormEvent, ReactElement } from "react";
import { LearningDialog } from "@/components/alter/dialog";
import { subscribeToHydration, clientReady, serverReady } from "@/lib/client-ready";

/** 저장이나 계정 변경 없이 현재 화면의 환영 문구만 조정합니다. */
export function Welcome(): ReactElement {
  const ready: boolean = useSyncExternalStore(subscribeToHydration, clientReady, serverReady);
  const [name, setName] = useState<string>(""); const [open, setOpen] = useState<boolean>(false);
  function applyName(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault(); const value: FormDataEntryValue | null = new FormData(event.currentTarget).get("displayName");
    if (typeof value !== "string" || value.trim().length === 0) throw new TypeError("표시 이름을 입력하세요.");
    setName(value.trim()); setOpen(false);
  }
  return <section className="welcome" aria-label="환영 문구"><p className="welcome-message" aria-live="polite">{name ? `${name}님, 반가워요.` : "나를 위한 작은 학습 공간"}</p>
    <LearningDialog open={open} onOpenChange={setOpen} trigger={<button className="alter-control alter-button" data-tone="secondary" type="button" disabled={!ready}>환영 문구 바꾸기</button>} title="어떻게 불러드릴까요?" closeLabel="취소" description="입력한 이름은 현재 화면에서만 사용해요. 화면을 새로 열면 지워집니다.">
      <form onSubmit={applyName} className="alter-form"><p id="name-description" className="alter-caption">표시 이름은 30자까지 입력할 수 있어요.</p><label className="alter-field">표시 이름<input id="display-name" aria-describedby="name-description" className="alter-control alter-input" name="displayName" defaultValue={name} required pattern={".*\\S.*"} maxLength={30} autoComplete="off"/></label><div className="alter-action-bar"><button className="alter-control alter-button" data-tone="primary" type="submit">적용하기</button></div></form>
    </LearningDialog>
  </section>;
}
