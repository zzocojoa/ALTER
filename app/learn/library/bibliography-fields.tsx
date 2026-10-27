"use client";
import { useState } from "react";
import type { ReactElement } from "react";
import type { SourceExcerpt } from "@/lib/librarian/contracts";

type BibliographyKind = "body" | "user-statement" | "publisher";
function bibliographyKind(value: string): BibliographyKind {
  if (value === "body" || value === "user-statement" || value === "publisher") return value;
  throw new TypeError("서지 확인 경로가 올바르지 않아요.");
}

/** 경로를 바꾸면 확인 체크를 해제하고 숨긴 입력은 보관하되 제출에서 제외합니다. */
export function BibliographyFields({ sources, covered, busy }: Readonly<{ sources: readonly SourceExcerpt[]; covered: boolean; busy: boolean }>): ReactElement {
  const [kind, setKind] = useState<BibliographyKind>("body");
  const [checked, setChecked] = useState<boolean>(false);
  return <fieldset className="library-bibliography"><legend>서지 확인 근거</legend><label>저자<input name="author" maxLength={300} /></label><label>출처<input name="origin" maxLength={500} /></label><label>확인 경로<select name="bibliographyKind" value={kind} onChange={(event): void => { setKind(bibliographyKind(event.target.value)); setChecked(false); }}><option value="body">PDF 본문에서 확인</option><option value="user-statement">사용자가 교재 정보를 확인</option><option value="publisher">출판사 페이지에서 확인</option></select></label><p>외부 서지는 본문과 별도로 보관해요. 판본을 모르면 비워 두세요. 학습 내용의 정확성을 보증하지 않아요.</p><fieldset hidden={kind === "body"} disabled={busy || kind === "body"}><legend>외부에서 확인한 교재 정보</legend><label>외부 서지 교재명<input name="bookTitle" maxLength={300} /></label><label>확인한 판본·발행연도 (모르면 비움)<input name="bookEdition" maxLength={300} /></label><label>서지 확인 주소 (출판사 확인 시 필수)<input name="bibliographyUrl" type="url" maxLength={1000} /></label><label>외부 서지 확인 내용<textarea name="bibliographyEvidence" maxLength={2000} placeholder="교재명·저자·출판사와 확인한 내용을 적어 주세요. 사용자 확인과 출판사에서 읽은 내용을 구분해 주세요." /></label></fieldset><div hidden={kind !== "body"}><label>본문에서 확인한 경우의 구간<select name="bibliographySource" defaultValue="" disabled={busy || kind !== "body"}><option value="">서지 근거 미확인</option>{sources.map((source): ReactElement => <option value={source.id} key={source.id}>파일 {source.filePage}쪽 · {covered ? "원문 가림" : source.evidence.slice(0,70)}</option>)}</select></label></div><label className="library-check"><input type="checkbox" name="bibliographyChecked" checked={checked} disabled={busy} onChange={(event): void => setChecked(event.target.checked)} /><span>선택한 경로의 서지 근거를 확인했어요. 모르는 판본은 미확인으로 남겨요.</span></label></fieldset>;
}
