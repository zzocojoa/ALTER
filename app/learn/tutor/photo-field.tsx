"use client";
import type { ReactElement } from "react";

export type TutorPhotoFieldProps = Readonly<{ busy: boolean; composing: boolean; saved: boolean; fileNames: readonly string[]; progress: string; onFile: (file: File) => void }>;

/** 등록된 자료와 답안 초안 저장 확인을 따로 표시합니다. */
export function TutorPhotoField({ busy, composing, saved, fileNames, progress, onFile }: TutorPhotoFieldProps): ReactElement {
  return <section className="tutor-photo-field" aria-label="풀이 사진 첨부">
    <label htmlFor="tutor-photo">풀이 사진<span className="tutor-field-required">선택 · 최대 4개</span></label>
    <input id="tutor-photo" type="file" accept="image/png,image/jpeg" disabled={busy || composing || fileNames.length >= 4} aria-describedby="tutor-photo-limits tutor-draft-status"
      onChange={(event): void => { const file: File | undefined = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) onFile(file); }} />
    <p id="tutor-photo-limits" className="tutor-field-hint">PNG·JPG 원본은 사진당 8MiB까지 보관해요. AI 판독은 사진당 2MiB·합계 4MiB 이내예요. 사진 첨부만으로 AI를 호출하지 않아요.</p>
    {progress && <p role="status" aria-label="사진 전송 상태" className="tutor-photo-progress">{progress}</p>}
    {fileNames.length > 0 && <><ul aria-label="등록된 풀이 사진">{fileNames.map((name, index): ReactElement => <li key={index}>첨부: {name}</li>)}</ul><p className="tutor-field-hint">{saved ? "등록된 사진이 서버 초안에 연결되어 있어요." : "사진은 등록됐어요. 답안 초안 저장 확인이 필요해요."}</p></>}
    <p className="tutor-field-hint">전송이 중단되면 같은 사진을 다시 선택해 이어서 확인해 주세요. 새로고침 후 파일 선택란이 비어 있어도 위 첨부 목록에 남아 있는 사진은 다시 올리지 않아도 돼요.</p>
  </section>;
}
