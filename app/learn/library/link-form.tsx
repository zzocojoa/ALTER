"use client";
import { useRef, useState } from "react";
import type { FormEvent, ReactElement } from "react";
import type { ConfirmedUnit } from "@/lib/librarian/contracts";
import { linkInput } from "@/lib/librarian/contracts";
import type { LibrarianAction } from "@/lib/librarian/request";
import type { MaterialLibrary } from "@/lib/materials/library";
import { formText, librarianJson, sourcesReply } from "./client-api";
import type { SourcesView } from "./client-api";
import type { LibraryStep } from "./library-steps";
import { BibliographyFields } from "./bibliography-fields";
import { SourceChoices, changeSelection } from "./selection-rows";

export function MaterialLinkForm({ unit, library, busy, covered, submit, step, onStep, onSourceReady, onLoading, onDirty }: Readonly<{ unit: ConfirmedUnit; library: MaterialLibrary; busy: boolean; covered: boolean; submit: (input: LibrarianAction) => Promise<boolean>; step: LibraryStep; onStep: (step: LibraryStep) => void; onSourceReady: (ready: boolean) => void; onLoading: (loading: boolean) => void; onDirty: (dirty: boolean) => void }>): ReactElement {
  const [dirty, setDirty] = useState<boolean>(false);
  const [bibliographyRevision, setBibliographyRevision] = useState<number>(0);
  const [selectedSources, setSelectedSources] = useState<readonly string[]>([]);
  const [sources, setSources] = useState<SourcesView | null>(null); const [loading, setLoading] = useState<boolean>(false); const [error, setError] = useState<string>(""); const newId = useRef<string>(crypto.randomUUID());
  async function load(id: string): Promise<void> {
    setError(""); setSources(null); setSelectedSources([]); onSourceReady(false); if (!id) return; setLoading(true); onLoading(true);
    try { setSources(sourcesReply.parse(await librarianJson(`/api/librarian/sources?materialId=${encodeURIComponent(id)}`, { method: "GET" }))); onSourceReady(true); onStep("range"); }
    catch (cause: unknown) { if (!(cause instanceof Error)) throw cause; setError(cause.message); } finally { setLoading(false); onLoading(false); }
  }
  async function link(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); if (!sources) return; const form = event.currentTarget; const data = new FormData(form); const checked = data.has("bibliographyChecked"); const evidenceKind = formText(data,"bibliographyKind");
    const external = evidenceKind === "body" ? undefined : { id: crypto.randomUUID(), kind: evidenceKind, title: formText(data,"bookTitle"), edition: formText(data,"bookEdition") || null, url: formText(data,"bibliographyUrl") || null, evidence: formText(data,"bibliographyEvidence") };
    const parsed = linkInput.safeParse({ id: newId.current,planVersionId: unit.planVersionId,unitId: unit.unitId,materialId: sources.material.id,toc: formText(data,"toc"),readingMinutes: Number(formText(data,"readingMinutes")),sourceRefIds: data.getAll("sources"),bibliography: { author: formText(data,"author"),origin: formText(data,"origin"),checked,evidenceSourceId: checked && external === undefined ? formText(data,"bibliographySource") : null, ...(external === undefined ? {} : { external }) } });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    if (await submit({ action: "link",link: parsed.data })) { newId.current = crypto.randomUUID(); form.reset(); }
  }
  return <section aria-label="자료에서 구간 연결"><div hidden={step !== "material"}><h3>이 단원에 자료 연결하기</h3><p>자료 보관함에서 원본과 대조하고 ‘확인 구간 출처 연결’을 누른 구간을 선택해 주세요.</p><label>자료<select defaultValue="" disabled={busy || loading || dirty} onChange={(event): void => { void load(event.target.value); }}><option value="">자료를 선택하세요</option>{library.materials.map((material) => <option value={material.id} key={material.id}>{material.metadata.title} · {material.metadata.edition || "판본 미입력"}</option>)}</select></label>{library.hasMore && <p>최근 50개 자료를 표시해요. 이전 자료는 자료 보관함에서 확인해 주세요.</p>}</div>{loading && <p role="status">현재 원문 구간을 확인하고 있어요.</p>}{error && <p role="alert">{error}</p>}
    {sources && <form id="library-link-input" hidden={step !== "range"} className="library-form" onChange={(): void => { setDirty(true); onDirty(true); }} onReset={(): void => { setDirty(false); onDirty(false); setSelectedSources([]); setBibliographyRevision((current): number => current + 1); }} onSubmit={link}><fieldset className="library-link-fields" disabled={busy || loading}><legend>새 확인 구간을 단원에 연결</legend><p>판본: {sources.material.metadata.edition || "미입력 — 자료 등록 시 판본이 필요해요"} · 역할: {sources.material.metadata.role === "textbook" ? "주교재" : sources.material.metadata.role === "answer" ? "답안" : "참고 자료"}</p><label>목차·구간 이름<input name="toc" required maxLength={2000} /></label><SourceChoices sources={sources.sources} selected={selectedSources} busy={busy || loading} covered={covered} onSelect={(id, checked): void => setSelectedSources((current): readonly string[] => changeSelection(current, id, checked))} />{sources.more && <p>최근 50개 확인 구간을 표시해요.</p>}<label>예상 읽기 시간 (분)<input name="readingMinutes" type="number" min={1} max={240} required /></label><BibliographyFields key={bibliographyRevision} sources={sources.sources} covered={covered} busy={busy || loading} /><button disabled={busy || loading}>이 구간을 단원에 연결</button></fieldset></form>}
  </section>;
}
