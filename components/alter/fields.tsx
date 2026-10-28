"use client";

import type { ComponentProps, ReactElement, ReactNode } from "react";
import { Field, FieldLabel, FieldDescription, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type FieldCopy = Readonly<{ id: string; label: string; hint: string | null; error: string | null }>;
type NativeInput = Omit<ComponentProps<typeof Input>, "id" | "className" | "type" | "aria-invalid" | "aria-describedby">;
export type TextFieldProps = FieldCopy & Readonly<{ type: "text" | "search" | "email" | "url" | "number" | "date" | "datetime-local" | "password"; input: NativeInput }>;
export type TextareaFieldProps = FieldCopy & Readonly<{ input: Omit<ComponentProps<typeof Textarea>, "id" | "className" | "aria-invalid" | "aria-describedby"> }>;
export type FileFieldProps = FieldCopy & Readonly<{ input: Omit<NativeInput, "value" | "defaultValue"> & { accept: string } }>;

function descriptionIds({ id, hint, error }: FieldCopy): string | undefined {
  const ids: readonly string[] = [...(hint === null ? [] : [id + "--hint"]), ...(error === null ? [] : [id + "--error"])];
  return ids.length === 0 ? undefined : ids.join(" ");
}

function FieldFrame({ id, label, hint, error, children }: FieldCopy & Readonly<{ children: ReactNode }>): ReactElement {
  if (error !== null && error.trim().length === 0) throw new TypeError("입력 오류에는 수정할 수 있는 설명이 필요합니다: " + id);
  return <Field orientation="vertical" className="alter-field" data-invalid={error !== null} role={undefined}>
    <FieldLabel id={id + "--label"} htmlFor={id} className="alter-label">{label}</FieldLabel>
    {children}
    {hint === null ? null : <FieldDescription id={id + "--hint"} className="alter-caption">{hint}</FieldDescription>}
    {error === null ? null : <FieldError id={id + "--error"} className="alter-field-error">{error}</FieldError>}
  </Field>;
}

/** 조합 입력·자동 저장 이벤트는 가공하지 않고 기존 입력 소유자에게 전달합니다. */
export function TextField({ input, type, ...copy }: TextFieldProps): ReactElement {
  return <FieldFrame {...copy}><Input {...input} type={type} id={copy.id} className="alter-control alter-input" aria-invalid={copy.error !== null} aria-describedby={descriptionIds(copy)} /></FieldFrame>;
}

export function TextareaField({ input, ...copy }: TextareaFieldProps): ReactElement {
  return <FieldFrame {...copy}><Textarea {...input} id={copy.id} className="alter-control alter-textarea" aria-invalid={copy.error !== null} aria-describedby={descriptionIds(copy)} /></FieldFrame>;
}

/** 파일 원본·업로드 정책은 호출자가 관리하며 파일 선택 값은 제어하지 않습니다. */
export function FileField({ input, ...copy }: FileFieldProps): ReactElement {
  return <FieldFrame {...copy}><Input {...input} type="file" id={copy.id} className="alter-control alter-file" aria-invalid={copy.error !== null} aria-describedby={descriptionIds(copy)} /></FieldFrame>;
}
