"use client";

import { useState, useSyncExternalStore } from "react";
import type { FormEvent, ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

function subscribeToHydration(): () => void {
  return () => undefined;
}

function clientReady(): boolean { return true; }
function serverReady(): boolean { return false; }

/** 저장이나 계정 변경 없이 현재 화면의 환영 문구만 조정합니다. */
export function Welcome(): ReactElement {
  const ready: boolean = useSyncExternalStore(subscribeToHydration, clientReady, serverReady);
  const [name, setName] = useState<string>("");
  const [open, setOpen] = useState<boolean>(false);

  function applyName(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const value: FormDataEntryValue | null = new FormData(event.currentTarget).get("displayName");
    if (typeof value !== "string" || value.trim().length === 0) throw new TypeError("표시 이름을 입력하세요.");
    setName(value.trim());
    setOpen(false);
  }

  return (
    <section className="welcome" aria-label="환영 문구">
      <p className="welcome-message" aria-live="polite">{name ? `${name}님, 반가워요.` : "나를 위한 작은 학습 공간"}</p>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild><Button type="button" variant="outline" size="lg" disabled={!ready}>환영 문구 바꾸기</Button></DialogTrigger>
        <DialogContent showCloseButton={false} aria-describedby="name-description">
          <DialogTitle>어떻게 불러드릴까요?</DialogTitle>
          <DialogDescription id="name-description">입력한 이름은 현재 화면에서만 사용해요. 화면을 새로 열면 지워집니다.</DialogDescription>
          <form onSubmit={applyName} className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="display-name" className="text-sm font-semibold">표시 이름</label>
              <Input id="display-name" name="displayName" defaultValue={name} required pattern={".*\\S.*"} maxLength={30} autoComplete="off" aria-describedby="name-description" />
            </div>
            <div className="flex justify-end gap-3">
              <DialogClose asChild><Button type="button" variant="outline">취소</Button></DialogClose>
              <Button type="submit">적용하기</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
