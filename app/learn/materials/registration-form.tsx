"use client";

import type { FormEvent, ReactElement, RefObject } from "react";
import { z } from "zod";
import { ActionButton, type ActionAvailability } from "@/components/alter/action-button";
import { TextField, TextareaField, FileField } from "@/components/alter/fields";
import { materialPolicy } from "@/lib/materials/policy";
import type { MaterialLibrary } from "@/lib/materials/library";

type RegistrationFormProps = Readonly<{ library: MaterialLibrary; formRef: RefObject<HTMLFormElement | null>; inputKind: "file" | "text"; busy: boolean; canStop: boolean; availability: ActionAvailability; onInputKind: (value: "file" | "text") => void; onUpload: (event: FormEvent<HTMLFormElement>) => Promise<void>; onCourse: (event: FormEvent<HTMLFormElement>) => Promise<void>; onStop: () => void }>;

export function RegistrationForm({ library, formRef, inputKind, busy, canStop, availability, onInputKind, onUpload, onCourse, onStop }: RegistrationFormProps): ReactElement {
  return <div className="alter-registration">
    <p className="alter-body">학습할 원본을 고르고 과정을 지정해 주세요. 등록만으로 AI 판독이 실행되지는 않아요.</p>
    <details className="alter-course-create" open={library.courses.length === 0}><summary className="alter-focus">새 과정 이름 만들기</summary><form onSubmit={onCourse}>
      <TextField id="material-course-title" label="과정 이름" type="text" hint={null} error={null} input={{ name: "courseTitle", maxLength: 300, required: true, placeholder: "예: 바리스타 필기" }} />
      <ActionButton id="material-create-course" type="submit" tone="secondary" availability={busy ? { kind: "busy", reason: "현재 요청을 확인하고 있어요." } : { kind: "available" }}>과정 만들기</ActionButton>
    </form></details>
    <form ref={formRef} onSubmit={onUpload}>
      <label className="alter-label" htmlFor="material-course">과정<select className="alter-control alter-input" id="material-course" name="courseId" required>{library.courses.length === 0 && <option value="">과정을 먼저 만들어 주세요</option>}{library.courses.map((course): ReactElement => <option key={course.id} value={course.id}>{course.title}</option>)}</select></label>
      <TextField id="material-title" label="자료 제목" type="text" hint={null} error={null} input={{ name: "title", required: true, maxLength: 300, placeholder: "예: 커피의 정의" }} />
      <TextField id="material-edition" label="판본 (선택)" type="text" hint="아는 경우에만 입력해 주세요." error={null} input={{ name: "edition", maxLength: 100, placeholder: "예: 2026년 개정판" }} />
      <label className="alter-label" htmlFor="material-role">자료 역할<select className="alter-control alter-input" id="material-role" name="role" aria-describedby="material-role-hint"><option value="textbook">주교재</option><option value="reference">참고 자료</option><option value="answer">사진 답안</option></select></label>
      <p id="material-role-hint" className="alter-caption">주교재는 학습할 내용, 참고 자료는 보충할 내용이에요. 사진 답안에는 JPG·PNG만 등록할 수 있어요.</p>
      <label className="alter-label" htmlFor="material-input-kind">입력 방식<select className="alter-control alter-input" id="material-input-kind" name="inputKind" value={inputKind} onChange={(event): void => onInputKind(z.enum(["file", "text"]).parse(event.target.value))}><option value="file">파일 선택</option><option value="text">텍스트 붙여넣기</option></select></label>
      <div hidden={inputKind !== "file"}><FileField id="material-file" label="원본 파일" hint="PDF·JPG·PNG·UTF-8 TXT만 지원해요. HEIC·동영상·음성은 등록할 수 없어요." error={null} input={{ name: "file", accept: ".pdf,.png,.jpg,.jpeg,.txt", disabled: inputKind !== "file" }} /></div>
      <div hidden={inputKind !== "text"}><TextareaField id="material-text" label="텍스트 원본" hint="UTF-8로 저장해요. 문자 수와 파일 바이트 수는 달라요." error={null} input={{ name: "text", rows: 8, maxLength: materialPolicy.types.text.maximumBytes, disabled: inputKind !== "text", placeholder: "학습할 텍스트를 붙여 넣어 주세요." }} /></div>
      <ul className="alter-material-limits" aria-label="파일별 등록 제한">
        <li>PDF: {materialPolicy.types.pdf.maximumBytes / 1048576} MiB · {materialPolicy.types.pdf.maximumPages}페이지</li>
        <li>JPG·PNG: {materialPolicy.types.image.maximumBytes / 1048576} MiB · {materialPolicy.types.image.maximumPixels / 10000}만 픽셀</li>
        <li>UTF-8 텍스트: {materialPolicy.types.text.maximumBytes / 1048576} MiB</li>
      </ul>
      <p className="alter-caption">전체 {materialPolicy.maximumStorageBytes / 1048576} MiB 안에서 원본과 미확정 예약을 함께 계산해요. 한 번에 {materialPolicy.maximumConcurrentTransfers}개만 전송해요.</p>
      <div className="alter-registration-actions"><ActionButton id="material-register" type="submit" tone="primary" availability={availability}>자료 등록하기</ActionButton>{canStop && <ActionButton id="material-stop" type="button" tone="secondary" availability={{ kind: "available" }} onClick={onStop}>전송 중단</ActionButton>}</div>
    </form>
  </div>;
}
