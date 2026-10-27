"use client";

import { useRef, type ReactElement, type ReactNode } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { X } from "lucide-react";
import { Dialog, DialogTrigger, DialogPortal, DialogOverlay, DialogTitle, DialogDescription, DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export type LearningDialogProps = Readonly<{ open: boolean; onOpenChange: (open: boolean) => void; trigger: ReactElement; title: string; closeLabel: string; description: string; children: ReactNode }>;

/** 휴대폰에서는 시트로 배치합니다. 입력 상태는 호출자가 소유하고 복귀 초점은 Radix Trigger가 보존합니다. */
export function LearningDialog({ open, onOpenChange, trigger, title, closeLabel, description, children }: LearningDialogProps): ReactElement {
  const heading = useRef<HTMLHeadingElement | null>(null);
  return <Dialog open={open} onOpenChange={onOpenChange} modal>
    <DialogTrigger asChild>{trigger}</DialogTrigger>
    <DialogPortal>
      <DialogOverlay data-alter-ui className="alter-overlay" />
      <DialogPrimitive.Content data-alter-ui className="alter-dialog" onOpenAutoFocus={(event): void => {
        event.preventDefault();
        if (heading.current === null) throw new TypeError("대화상자의 제목 초점이 준비되지 않았습니다.");
        heading.current.focus();
      }} onInteractOutside={(event): void => event.preventDefault()}>
        <div className="alter-dialog-header">
          <DialogTitle ref={heading} tabIndex={-1} className="alter-subheading alter-focus">{title}</DialogTitle>
          <DialogClose asChild><Button type="button" variant="outline" size="default" className="alter-control alter-button"><X className="alter-icon" aria-hidden="true" focusable="false" />{closeLabel}</Button></DialogClose>
        </div>
        <DialogDescription className="alter-caption">{description}</DialogDescription>
        <div className="alter-dialog-body">{children}</div>
      </DialogPrimitive.Content>
    </DialogPortal>
  </Dialog>;
}
