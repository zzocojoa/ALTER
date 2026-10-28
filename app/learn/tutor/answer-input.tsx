"use client";
import { useState } from "react";
import type { ReactElement } from "react";

export type AnswerInputProps = Readonly<{ id: string; label: string; value: string; limit: number; required: boolean; describedBy: string; busy: boolean; onValue: (value: string) => void; onComposition: (active: boolean) => void }>;

/** 한글 조합과 붙여넣기를 자르지 않고, 제한을 넘긴 입력은 수정할 수 있게 남깁니다. */
export function AnswerInput({ id, label, value, limit, required, describedBy, busy, onValue, onComposition }: AnswerInputProps): ReactElement {
  const [visited, setVisited] = useState<boolean>(false);
  const over: boolean = value.length > limit;
  const missing: boolean = visited && required && !value.trim();
  return <div className="tutor-answer-field"><label htmlFor={id}>{label}{required && <span className="tutor-field-required" aria-hidden="true">필수</span>}</label>
    <textarea id={id} value={value} rows={7} required={required} disabled={busy} aria-invalid={over || missing} aria-describedby={`${id}-limit ${describedBy}`.trim()}
      onChange={(event): void => onValue(event.currentTarget.value)} onBlur={(): void => setVisited(true)}
      onCompositionStart={(): void => onComposition(true)} onCompositionEnd={(event): void => { onValue(event.currentTarget.value); onComposition(false); }} />
    <p id={`${id}-limit`} className={over || missing ? "tutor-field-issue" : "tutor-field-hint"}>{value.length.toLocaleString("ko-KR")} / {limit.toLocaleString("ko-KR")}자{over ? " · 제한을 넘겼어요. 입력은 지우지 않았으며 줄인 뒤 저장할 수 있어요." : missing ? " · 이 항목을 직접 작성해 주세요." : ""}</p>
  </div>;
}
