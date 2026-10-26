"use client";
import { useRef, useState } from "react";
import type { FormEvent, ReactElement } from "react";
import type { ConfirmedUnit } from "@/lib/librarian/contracts";
import { linkInput } from "@/lib/librarian/contracts";
import type { LibrarianAction } from "@/lib/librarian/request";
import type { MaterialLibrary } from "@/lib/materials/library";
import { formText, librarianJson, sourcesReply } from "./client-api";
import type { SourcesView } from "./client-api";

export function MaterialLinkForm({ unit, library, busy, covered, submit }: Readonly<{ unit: ConfirmedUnit; library: MaterialLibrary; busy: boolean; covered: boolean; submit: (input: LibrarianAction) => Promise<boolean> }>): ReactElement {
  const [sources, setSources] = useState<SourcesView | null>(null); const [loading, setLoading] = useState<boolean>(false); const [error, setError] = useState<string>(""); const newId = useRef<string>(crypto.randomUUID());
  async function load(id: string): Promise<void> {
    setError(""); setSources(null); if (!id) return; setLoading(true);
    try { setSources(sourcesReply.parse(await librarianJson(`/api/librarian/sources?materialId=${encodeURIComponent(id)}`, { method: "GET" }))); }
    catch (cause: unknown) { if (!(cause instanceof Error)) throw cause; setError(cause.message); } finally { setLoading(false); }
  }
  async function link(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); if (!sources) return; const form = event.currentTarget; const data = new FormData(form); const checked = data.has("bibliographyChecked"); const evidenceKind = formText(data,"bibliographyKind");
    const external = evidenceKind === "body" ? undefined : { id: crypto.randomUUID(), kind: evidenceKind, title: formText(data,"bookTitle"), edition: formText(data,"bookEdition") || null, url: formText(data,"bibliographyUrl") || null, evidence: formText(data,"bibliographyEvidence") };
    const parsed = linkInput.safeParse({ id: newId.current,planVersionId: unit.planVersionId,unitId: unit.unitId,materialId: sources.material.id,toc: formText(data,"toc"),readingMinutes: Number(formText(data,"readingMinutes")),sourceRefIds: data.getAll("sources"),bibliography: { author: formText(data,"author"),origin: formText(data,"origin"),checked,evidenceSourceId: checked && external === undefined ? formText(data,"bibliographySource") : null, ...(external === undefined ? {} : { external }) } });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    if (await submit({ action: "link",link: parsed.data })) { newId.current = crypto.randomUUID(); form.reset(); }
  }
  return <details><summary>이 단원에 자료 연결하기</summary><p>자료 보관함에서 원본과 대조하고 ‘확인 구간 출처 연결’을 누른 구간을 선택해 주세요.</p><label>자료<select defaultValue="" disabled={busy || loading} onChange={(event): void => { void load(event.target.value); }}><option value="">자료를 선택하세요</option>{library.materials.map((material) => <option value={material.id} key={material.id}>{material.metadata.title} · {material.metadata.edition || "판본 미입력"}</option>)}</select></label>{library.hasMore && <p>최근 50개 자료를 표시해요. 이전 자료는 자료 보관함에서 확인해 주세요.</p>}{loading && <p role="status">현재 원문 구간을 확인하고 있어요.</p>}{error && <p role="alert">{error}</p>}
    {sources && <form className="library-form" onSubmit={link}><p>판본: {sources.material.metadata.edition || "미입력 — 자료 등록 시 판본이 필요해요"} · 역할: {sources.material.metadata.role === "textbook" ? "주교재" : sources.material.metadata.role === "answer" ? "답안" : "참고 자료"}</p><label>목차·구간 이름<input name="toc" required maxLength={2000} /></label><fieldset><legend>이번에 연결할 확인 구간 (최대 8개)</legend>{sources.sources.map((source) => <label key={source.id} className="library-check"><input type="checkbox" name="sources" value={source.id} /><span>파일 {source.filePage}쪽 · {covered ? "원문 가림" : source.evidence.slice(0,100)} <a href={`/learn/source/${source.id}`} target="_blank" rel="noreferrer">원본 구간 확인</a></span></label>)}{sources.sources.length === 0 && <p>확인된 출처가 없어요. <a href="/learn/materials">자료 보관함에서 본문을 확인</a>한 뒤 다시 선택해 주세요. 미확인 연결로 저장할 수도 있어요.</p>}{sources.more && <p>최근 50개 확인 구간을 표시해요.</p>}</fieldset><label>예상 읽기 시간 (분)<input name="readingMinutes" type="number" min={1} max={240} required /></label><label>저자<input name="author" maxLength={300} /></label><label>출처<input name="origin" maxLength={500} /></label><fieldset><legend>서지 확인 근거</legend><label>확인 경로<select name="bibliographyKind" defaultValue="body"><option value="body">PDF 본문에서 확인</option><option value="user-statement">사용자가 교재 정보를 확인</option><option value="publisher">출판사 페이지에서 확인</option></select></label><p>외부 서지는 본문과 별도로 보관해요. 판본을 모르면 비워 두세요. 학습 내용의 정확성을 보증하지 않아요.</p><label>외부 서지 교재명<input name="bookTitle" maxLength={300} /></label><label>확인한 판본·발행연도 (모르면 비움)<input name="bookEdition" maxLength={300} /></label><label>서지 확인 주소 (출판사 확인 시 필수)<input name="bibliographyUrl" type="url" maxLength={1000} /></label><label>외부 서지 확인 내용<textarea name="bibliographyEvidence" maxLength={2000} placeholder="교재명·저자·출판사와 확인한 내용을 적어 주세요. 사용자 확인과 출판사에서 읽은 내용을 구분해 주세요." /></label><label>본문에서 확인한 경우의 구간<select name="bibliographySource" defaultValue=""><option value="">서지 근거 미확인</option>{sources.sources.map((source) => <option value={source.id} key={source.id}>파일 {source.filePage}쪽 · {covered ? "원문 가림" : source.evidence.slice(0,70)}</option>)}</select></label><label className="library-check"><input type="checkbox" name="bibliographyChecked" /><span>선택한 경로의 서지 근거를 확인했어요. 모르는 판본은 미확인으로 남겨요.</span></label></fieldset><button disabled={busy || loading}>이 구간을 단원에 연결</button></form>}
  </details>;
}
