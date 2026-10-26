"use client";

import { clientReady, serverReady, subscribeToHydration } from "@/lib/client-ready";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { FormEvent, ReactElement } from "react";
import { z } from "zod";
import { materialRole, validateMaterialMetadata } from "@/lib/materials/policy";
import type { MaterialMetadata } from "@/lib/materials/policy";
import type { MaterialCard, MaterialLibrary, PendingMaterial } from "@/lib/materials/library";
import { errorText, inventoryReply, loadMaterialLibrary, materialJson, transferReply } from "./client-api";
import { hashClientFile } from "@/lib/materials/client-file";
import { SourcePreview } from "./source-preview";

const roles: Readonly<Record<MaterialMetadata["role"], string>> = { textbook: "주교재", reference: "참고 자료", answer: "사진 답안" };
const stages: Readonly<Record<PendingMaterial["state"], string>> = { reserved: "전송 준비", transferring: "전송 중", stored: "원본 저장 완료 · 검증 대기", validating: "원본 검증 중", verified: "등록 확정 대기", registered: "등록 완료", unknown: "저장 결과 확인 필요", failed: "중단됨", cleaning: "임시 파일 정리 확인 중", discarded: "정리 완료" };
function size(bytes: number): string { return `${(bytes / 1048576).toFixed(2)} MiB`; }
function selectedFile(form: HTMLFormElement): File {
  const data: FormData = new FormData(form);
  if (data.get("inputKind") === "text") {
    const value: string = String(data.get("text") ?? "");
    if (value.trim().length === 0) throw new Error("등록할 텍스트를 붙여 넣어 주세요.");
    return new File([value], "붙여넣은-텍스트.txt", { type: "text/plain" });
  }
  const file: FormDataEntryValue | null = data.get("file");
  if (!(file instanceof File) || file.size < 1) throw new Error("등록할 파일을 선택해 주세요.");
  return file;
}
async function metadataFor(form: HTMLFormElement, file: File): Promise<MaterialMetadata> {
  const data: FormData = new FormData(form);
  const suffix: string = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  const type = { ".pdf": { kind: "pdf", mime: "application/pdf" }, ".png": { kind: "image", mime: "image/png" }, ".jpg": { kind: "image", mime: "image/jpeg" }, ".jpeg": { kind: "image", mime: "image/jpeg" }, ".txt": { kind: "text", mime: "text/plain" } } as const;
  if (!(suffix in type)) throw new Error("PDF·JPG·PNG·UTF-8 TXT 파일을 선택해 주세요. HEIC는 지원하지 않아요.");
  const selected = type[suffix as keyof typeof type];
  const role = materialRole.parse(data.get("role"));
  if (role === "answer" && selected.kind !== "image") throw new Error("사진 답안에는 JPG 또는 PNG 파일을 선택해 주세요.");
  const declared = { title: data.get("title"), edition: data.get("edition"), role, ...selected, filename: file.name, bytes: file.size, sha256: "0".repeat(64) };
  validateMaterialMetadata(declared);
  return validateMaterialMetadata({ ...declared, sha256: await hashClientFile(file) });
}

/** 클릭한 자료의 미리보기로 시각적 위치와 키보드 초점을 함께 이동합니다. */
function revealPreview(element: HTMLElement | null): void {
  if (element === null) return;
  element.focus({ preventScroll: true });
  element.scrollIntoView({ behavior: "instant", block: "start" });
}

export function MaterialLibraryClient({ initial, initialSelectedId }: Readonly<{ initial: MaterialLibrary; initialSelectedId: string | null }>): ReactElement {
  const ready = useSyncExternalStore(subscribeToHydration, clientReady, serverReady);
  const [library, setLibrary] = useState<MaterialLibrary>(initial);
  const [selected, setSelected] = useState<MaterialCard | null>(() => initial.hidden ? null : initial.materials.find(item => item.id === initialSelectedId) ?? null);
  const [inputKind, setInputKind] = useState<"file" | "text">("file");
  const [busy, setBusy] = useState<boolean>(true);
  const [message, setMessage] = useState<string>("");
  const [failure, setFailure] = useState<string>(initialSelectedId !== null && !initial.hidden && !initial.materials.some(item => item.id === initialSelectedId) ? "요청한 자료를 현재 목록에서 찾지 못했어요. 자료 목록을 새로 확인해 주세요." : "");
  const preview = useRef<HTMLElement>(null);
  const selectedButton = useRef<HTMLButtonElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const abort = useRef<AbortController | null>(null);
  const requestKey = useRef<string | null>(null);
  useEffect((): (() => void) => {
    // SSR에서 활성화된 버튼의 클릭이 유실되지 않도록 이벤트 연결 직후 한 번만 엽니다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBusy(false);
    function conceal(): void { if (document.visibilityState === "hidden") setSelected(null); }
    document.addEventListener("visibilitychange", conceal);
    return (): void => { document.removeEventListener("visibilitychange", conceal); abort.current?.abort(); };
  }, []);
  useEffect((): void => { revealPreview(preview.current); }, [selected]);
  function returnToList(): void {
    selectedButton.current?.focus({ preventScroll: true });
    selectedButton.current?.scrollIntoView({ behavior: "instant", block: "center" });
  }
  async function refresh(): Promise<void> { const current: MaterialLibrary = await loadMaterialLibrary(null); setLibrary(current); if (current.hidden) setSelected(null); }
  async function sendFile(id: string, version: number, file: File, metadata: MaterialMetadata): Promise<void> {
    abort.current = new AbortController();
    setMessage("원본을 전송하고 있어요…");
    const stored = transferReply.parse(await materialJson(`/api/materials/uploads/${id}/body`, { method: "PUT", headers: { "content-type": metadata.mime, "x-upload-version": String(version) }, body: file, signal: abort.current.signal }));
    setMessage("내용을 검증하고 있어요. 원본을 확인한 뒤 등록합니다.");
    await materialJson(`/api/materials/uploads/${id}/complete`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedVersion: stored.version }), signal: abort.current.signal });
    requestKey.current = null; setMessage("자료를 등록했어요. 목록에서 원본을 열어 보세요.");
  }
  async function upload(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); setBusy(true); setFailure(""); setSelected(null);
    try {
      const element: HTMLFormElement = event.currentTarget;
      const file: File = selectedFile(element);
      const metadata: MaterialMetadata = await metadataFor(element, file);
      const courseId: string = z.string().uuid().parse(new FormData(element).get("courseId"));
      requestKey.current ??= crypto.randomUUID();
      setMessage("자료 저장 공간을 예약하고 있어요…");
      const started = transferReply.parse(await materialJson("/api/materials/uploads", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": requestKey.current }, body: JSON.stringify({ courseId, metadata }) }));
      await sendFile(started.id, started.version, file, metadata);
    } catch (error: unknown) { setFailure(errorText(error)); setMessage("등록 상태는 아래 중단된 자료에서 확인할 수 있어요."); }
    finally { abort.current = null; setBusy(false); await refresh().catch((error: unknown): void => { setFailure(errorText(error)); }); }
  }
  async function recover(item: PendingMaterial): Promise<void> {
    setBusy(true); setFailure("");
    try {
      const result = z.object({ nextAction: z.enum(["upload", "cleanup", "registered", "new-upload"]), version: z.number().int().positive() }).passthrough().parse(await materialJson(`/api/materials/uploads/${item.id}/recover`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedVersion: item.version }) }));
      if (result.nextAction === "upload") {
        if (form.current === null) throw new Error("파일 선택 화면을 찾을 수 없어요.");
        const file: File = selectedFile(form.current);
        if (file.size !== item.metadata.bytes || await hashClientFile(file) !== item.metadata.sha256) throw new Error("처음 등록한 것과 같은 파일이나 텍스트를 선택해 주세요.");
        await sendFile(item.id, result.version, file, item.metadata);
      } else setMessage(result.nextAction === "registered" ? "저장된 원본을 확인해 등록했어요." : "전송이 중단됐어요. 임시 파일을 정리한 뒤 새로 등록할 수 있어요.");
    } catch (error: unknown) { setFailure(errorText(error)); }
    finally { abort.current = null; setBusy(false); await refresh().catch((error: unknown): void => { setFailure(errorText(error)); }); }
  }
  async function cleanup(item: PendingMaterial): Promise<void> {
    setBusy(true); setFailure("");
    try { await materialJson(`/api/materials/uploads/${item.id}/cleanup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedVersion: item.version }) }); requestKey.current = null; setMessage("요청한 임시 자료만 정리했어요. 새로 등록할 수 있어요."); }
    catch (error: unknown) { setFailure(errorText(error)); }
    finally { setBusy(false); await refresh().catch((error: unknown): void => { setFailure(errorText(error)); }); }
  }
  async function createCourse(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); const title: string = String(new FormData(event.currentTarget).get("courseTitle") ?? ""); setBusy(true); setFailure("");
    try { await materialJson("/api/materials/courses", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ title }) }); await refresh(); setMessage("과정을 만들었어요. 이 과정에 자료를 등록할 수 있어요."); }
    catch (error: unknown) { setFailure(errorText(error)); } finally { setBusy(false); }
  }
  async function verifyStorage(): Promise<void> {
    setBusy(true); setFailure(""); setMessage("저장 공간을 확인하고 있어요…");
    try { inventoryReply.parse(await materialJson("/api/materials/storage-check", { method: "POST", signal: AbortSignal.timeout(30000) })); setMessage("실제 저장 공간과 쓰기·읽기를 확인했어요. 자료를 등록할 수 있어요."); }
    catch (error: unknown) { setFailure(errorText(error)); }
    finally { setBusy(false); await refresh().catch((error: unknown): void => { setFailure(errorText(error)); }); }
  }
  async function nextPage(): Promise<void> { setBusy(true); try { const next: MaterialLibrary = await loadMaterialLibrary(library.cursor); setLibrary({ ...next, materials: [...library.materials, ...next.materials] }); } catch (error: unknown) { setFailure(errorText(error)); } finally { setBusy(false); } }
  const canUpload: boolean = library.usage !== null && !library.usage.blocked && library.pending.length === 0 && library.courses.length > 0;
  return <div className="material-library" inert={!ready}><div className="material-summary"><p>원본을 모아 두고, 필요한 부분부터 차근차근 살펴보세요.</p><p>{library.usage === null ? "자료 저장 준비가 아직 완료되지 않았어요." : `${size(library.usage.occupiedBytes)} 사용 · ${size(library.usage.reservedBytes)} 예약 / 256 MiB`}</p></div><button type="button" disabled={busy || library.pending.length > 0} onClick={(): void => { void verifyStorage(); }}>저장 공간 확인</button><div className="material-feedback" aria-live="polite"><p role="status">{message}</p>{failure && <p role="alert">{failure} <a href="/signin-with-chatgpt?return_to=/learn/materials">다시 로그인</a></p>}</div><div className="material-layout"><aside className="material-upload-panel"><h2>자료 등록</h2><details open={library.courses.length === 0}><summary>새 과정 이름 만들기</summary><form onSubmit={createCourse}><label>과정 이름<input name="courseTitle" maxLength={300} required placeholder="예: 정보처리기사" /></label><button type="submit" disabled={busy}>과정 만들기</button></form></details><form ref={form} onSubmit={upload}><label>과정<select name="courseId" required>{library.courses.length === 0 && <option value="">과정을 먼저 만들어 주세요</option>}{library.courses.map((course): ReactElement => <option key={course.id} value={course.id}>{course.title}</option>)}</select></label><label>자료 제목<input name="title" required maxLength={300} placeholder="예: 운영체제 요약" /></label><label>판본 <span className="material-note">선택</span><input name="edition" maxLength={100} placeholder="예: 2026년 개정판" /></label><label>자료 역할<select name="role"><option value="textbook">주교재</option><option value="reference">참고 자료</option><option value="answer">사진 답안</option></select></label><label>입력 방식<select name="inputKind" value={inputKind} onChange={(event): void => { setInputKind(z.enum(["file", "text"]).parse(event.target.value)); }}><option value="file">파일 선택</option><option value="text">텍스트 붙여넣기</option></select></label>{inputKind === "file" ? <label>원본 파일<input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.txt" /></label> : <label>텍스트 원본<textarea name="text" rows={8} maxLength={1048576} placeholder="학습할 텍스트를 붙여 넣어 주세요." /></label>}<p className="material-note">PDF 20MiB·500페이지, JPG·PNG 8MiB·1,600만 픽셀, UTF-8 텍스트 1MiB까지 등록해요.</p><button className="material-primary" type="submit" disabled={busy || !canUpload}>자료 등록하기</button>{busy && <button type="button" onClick={(): void => { abort.current?.abort(new Error("전송을 중단했어요. 상태를 확인해 주세요.")); }}>전송 중단</button>}</form></aside><section className="material-shelf" aria-label="나의 자료 목록"><div className="material-section-heading"><h2>나의 자료 <span>{library.materials.length}</span></h2><button type="button" disabled={busy} onClick={(): void => { void refresh().catch((error: unknown): void => { setFailure(errorText(error)); }); }}>목록 새로 확인</button></div>{library.hidden && <p role="status" className="material-hidden">자료를 가리고 답하는 중이에요. 답안을 제출한 뒤 원본을 열 수 있어요.</p>}{library.pending.length > 0 && <section className="material-pending" aria-label="중단된 자료"><h3>확인이 필요한 자료</h3>{library.pending.map((item): ReactElement => <div key={item.id}><strong>{item.metadata.title}</strong><p>{stages[item.state]}</p><div className="material-toolbar"><button type="button" disabled={busy} onClick={(): void => { void recover(item); }}>상태 확인·이어서 등록</button><button type="button" disabled={busy} onClick={(): void => { void cleanup(item); }}>이 임시 자료 정리</button></div></div>)}</section>}{library.materials.length === 0 ? <div className="material-empty"><p className="eyebrow">첫 번째 자료</p><h3>배울 내용을 한곳에</h3><p>교재나 사진, 정리한 문장을 등록하면<br />여기에서 원본을 다시 볼 수 있어요.</p></div> : <ul className="material-list">{library.materials.map((item): ReactElement => <li key={item.id}><button type="button" disabled={library.hidden || busy} aria-pressed={selected?.id === item.id} onClick={(event): void => { selectedButton.current = event.currentTarget; if (selected?.id === item.id) revealPreview(preview.current); else setSelected(item); }}><span className="material-format">{item.metadata.kind === "pdf" ? "PDF" : item.metadata.kind === "image" ? "사진" : "TXT"}</span><span><strong>{item.metadata.title}</strong><small>{roles[item.metadata.role]}{item.metadata.edition ? ` · ${item.metadata.edition}` : ""} · {item.file.pages}페이지 · {size(item.file.bytes)}</small></span><span aria-hidden="true">보기</span></button></li>)}</ul>}{library.hasMore && <button type="button" disabled={busy} onClick={(): void => { void nextPage(); }}>자료 더 보기</button>}{selected && !library.hidden && <SourcePreview key={selected.id} material={selected} previewRef={preview} onReturnToList={returnToList} />}</section></div></div>;
}
