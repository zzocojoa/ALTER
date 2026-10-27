"use client";

import { clientReady, serverReady, subscribeToHydration } from "@/lib/client-ready";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { FormEvent, ReactElement } from "react";
import { z } from "zod";
import { materialRole, validateMaterialMetadata } from "@/lib/materials/policy";
import type { MaterialMetadata } from "@/lib/materials/policy";
import type { MaterialCard, MaterialLibrary, PendingMaterial } from "@/lib/materials/library";
import { errorText, inventoryReply, loadMaterialLibrary, materialJson, transferReply, registrationReply, recoveryReply, cleanupReply } from "./client-api";
import { hashClientFile } from "@/lib/materials/client-file";
import { SourcePreview } from "./source-preview";
import { MaterialList } from "./material-list";
import { RegistrationForm } from "./registration-form";
import { Disclosure } from "@/components/alter/disclosure";
import { ErrorState } from "@/components/alter/status";
import { PendingMaterials } from "./pending-materials";
import { uploadIssue, type UploadIssue } from "./upload-issue";
import type { ActionAvailability } from "@/components/alter/action-button";
import { UploadProgress, type UploadPhase } from "./upload-progress";
import "./library.css";

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
  const [registrationOpen, setRegistrationOpen] = useState<boolean>(initial.materials.length === 0);
  const [inputKind, setInputKind] = useState<"file" | "text">("file");
  const [busy, setBusy] = useState<boolean>(true);
  const [issue, setIssue] = useState<UploadIssue | null>(null);
  const [listFresh, setListFresh] = useState<boolean>(true);
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>("idle");
  const [message, setMessage] = useState<string>("");
  const [failure, setFailure] = useState<string>(initialSelectedId !== null && !initial.hidden && !initial.materials.some(item => item.id === initialSelectedId) ? "요청한 자료를 현재 목록에서 찾지 못했어요. 자료 목록을 새로 확인해 주세요." : "");
  const preview = useRef<HTMLElement>(null);
  const returnMaterialId = useRef<string | null>(selected?.id ?? null);
  const shouldReturnFocus = useRef<boolean>(false);
  const selectionEntry = useRef<boolean>(false);
  const newlyRegisteredId = useRef<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const abort = useRef<AbortController | null>(null);
  const requestKey = useRef<string | null>(null);
  const operation = useRef<boolean>(true);
  useEffect((): (() => void) => {
    // SSR에서 활성화된 버튼의 클릭이 유실되지 않도록 이벤트 연결 직후 한 번만 엽니다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBusy(false); operation.current = false;
    function conceal(): void { if (document.visibilityState === "hidden") setSelected(null); }
    document.addEventListener("visibilitychange", conceal);
    return (): void => { document.removeEventListener("visibilitychange", conceal); abort.current?.abort(); };
  }, []);
  useEffect((): void => {
    if (selected !== null) { revealPreview(preview.current); return; }
    if (!shouldReturnFocus.current) return;
    shouldReturnFocus.current = false;
    const button: HTMLElement | null = returnMaterialId.current === null ? null : document.getElementById(`material-${returnMaterialId.current}`);
    const destination: HTMLElement | null = button ?? document.getElementById("material-list-heading");
    destination?.focus({ preventScroll: true }); destination?.scrollIntoView({ behavior: "instant", block: "center" });
  }, [selected]);
  useEffect((): (() => void) => {
    function restoreSelection(): void {
      const id: string | null = new URL(window.location.href).searchParams.get("open");
      if (id === null) { selectionEntry.current = false; shouldReturnFocus.current = true; setSelected(null); return; }
      const item: MaterialCard | undefined = library.materials.find((entry): boolean => entry.id === id);
      if (library.hidden || !listFresh || item === undefined) { setSelected(null); setFailure("이 자료는 현재 목록에서 열 수 없어요. 목록을 새로 확인해 주세요."); return; }
      returnMaterialId.current = item.id; setSelected(item);
    }
    window.addEventListener("popstate", restoreSelection);
    return (): void => window.removeEventListener("popstate", restoreSelection);
  }, [library, listFresh]);
  function openMaterial(item: MaterialCard): void {
    returnMaterialId.current = item.id;
    const url: URL = new URL(window.location.href);
    const replacing: boolean = url.searchParams.has("open");
    url.searchParams.set("open", item.id);
    if (replacing) window.history.replaceState(window.history.state, "", url);
    else { window.history.pushState(window.history.state, "", url); selectionEntry.current = true; }
    if (selected?.id === item.id) revealPreview(preview.current);
    setSelected(item);
  }
  function returnToList(): void {
    shouldReturnFocus.current = true;
    if (selectionEntry.current) { window.history.back(); return; }
    const url: URL = new URL(window.location.href); url.searchParams.delete("open");
    window.history.replaceState(window.history.state, "", url); setSelected(null);
  }
  function beginOperation(): boolean {
    if (operation.current) return false;
    operation.current = true; setBusy(true); setFailure(""); setMessage(""); return true;
  }
  async function refresh(): Promise<void> {
    setListFresh(false); setSelected(null);
    const current: MaterialLibrary = await loadMaterialLibrary(null);
    setLibrary(current); setListFresh(true);
    if (newlyRegisteredId.current !== null) {
      const id: string = newlyRegisteredId.current;
      const registered: MaterialCard | undefined = current.materials.find((item): boolean => item.id === id);
      if (current.hidden) { newlyRegisteredId.current = null; setMessage("자료 등록은 확인했어요. 자료를 가리고 답하는 동안에는 원본을 열지 않아요."); }
      else if (registered === undefined) throw new Error("서버 등록은 확인했지만 새 자료를 목록에서 찾지 못했어요. 목록 새로 확인을 눌러 주세요.");
      else { newlyRegisteredId.current = null; setRegistrationOpen(false); openMaterial(registered); }
    }
  }
  async function finishOperation(): Promise<void> {
    abort.current = null;
    try { await refresh(); } catch (error: unknown) { setFailure(errorText(error)); }
    finally { operation.current = false; setBusy(false); }
  }
  async function refreshList(): Promise<void> {
    if (!beginOperation()) return;
    await finishOperation();
  }
  async function sendFile(id: string, version: number, file: File, metadata: MaterialMetadata): Promise<void> {
    abort.current = new AbortController();
    setUploadPhase("transferring"); setMessage("");
    const stored = transferReply.parse(await materialJson(`/api/materials/uploads/${id}/body`, { method: "PUT", headers: { "content-type": metadata.mime, "x-upload-version": String(version) }, body: file, signal: abort.current.signal }));
    if (stored.id !== id || stored.state !== "stored") throw new Error("원본 전송 응답이 요청과 달라요. 같은 요청의 상태를 확인해 주세요.");
    setUploadPhase("confirming");
    const registered = registrationReply.parse(await materialJson(`/api/materials/uploads/${id}/complete`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedVersion: stored.version }), signal: abort.current.signal }));
    if (registered.id !== id || registered.materialId !== stored.materialId) throw new Error("등록 응답의 자료가 요청과 달라요. 같은 요청의 상태를 확인해 주세요.");
    requestKey.current = null; newlyRegisteredId.current = registered.materialId; setUploadPhase("confirmed"); setMessage("자료 등록을 확인했어요. 새 자료의 원본을 열어요.");
  }
  async function upload(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); if (!beginOperation()) return; setIssue(null); setSelected(null); setMessage(""); setUploadPhase("checking");
    try {
      const element: HTMLFormElement = event.currentTarget;
      const file: File = selectedFile(element);
      const metadata: MaterialMetadata = await metadataFor(element, file);
      const courseId: string = z.string().uuid().parse(new FormData(element).get("courseId"));
      requestKey.current ??= crypto.randomUUID();
      setUploadPhase("reserving");
      const started = transferReply.parse(await materialJson("/api/materials/uploads", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": requestKey.current }, body: JSON.stringify({ courseId, metadata }) }));
      if (started.state === "registered") { requestKey.current = null; newlyRegisteredId.current = started.materialId; setUploadPhase("confirmed"); setMessage("이 요청은 이미 등록됐어요. 중복 전송하지 않았어요."); }
      else if (started.state === "reserved") await sendFile(started.id, started.version, file, metadata);
      else throw new Error("이 요청의 원본 전송이 이미 시작됐어요. 아래 기존 요청에서 상태 확인·이어서 등록을 눌러 주세요.");
    } catch (error: unknown) { setUploadPhase("attention"); setIssue(uploadIssue(error, abort.current?.signal.aborted === true)); setFailure(errorText(error)); setMessage("입력한 제목과 선택한 원본은 유지했어요."); }
    finally { await finishOperation(); }
  }
  async function recover(item: PendingMaterial): Promise<void> {
    if (!beginOperation()) return; setIssue(null); setRegistrationOpen(true);
    try {
      const result = recoveryReply.parse(await materialJson(`/api/materials/uploads/${item.id}/recover`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedVersion: item.version }) }));
      if (result.id !== item.id || result.materialId !== item.materialId) throw new Error("복구 응답의 자료가 요청과 달라요. 목록을 다시 확인해 주세요.");
      if (result.nextAction === "upload") {
        if (form.current === null) throw new Error("파일 선택 화면을 찾을 수 없어요.");
        const file: File = selectedFile(form.current);
        if (file.size !== item.metadata.bytes || await hashClientFile(file) !== item.metadata.sha256) throw new Error("처음 등록한 것과 같은 파일이나 텍스트를 선택해 주세요.");
        await sendFile(item.id, result.version, file, item.metadata);
      } else if (result.nextAction === "registered") { requestKey.current = null; newlyRegisteredId.current = result.materialId; setUploadPhase("confirmed"); setMessage("저장된 원본을 확인해 등록했어요."); }
      else { if (result.nextAction === "new-upload") requestKey.current = null; setUploadPhase("attention"); setMessage(result.nextAction === "new-upload" ? "기존 요청의 정리가 확인됐어요. 새로 등록할 수 있어요." : "전송이 중단됐어요. 같은 요청의 임시 파일을 확인한 뒤 정리할 수 있어요."); }
    } catch (error: unknown) { setUploadPhase("attention"); setIssue(uploadIssue(error, abort.current?.signal.aborted === true)); setFailure(errorText(error)); }
    finally { await finishOperation(); }
  }
  async function cleanup(item: PendingMaterial): Promise<void> {
    if (!beginOperation()) return;
    try { const result = cleanupReply.parse(await materialJson(`/api/materials/uploads/${item.id}/cleanup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedVersion: item.version }) })); if (result.id !== item.id || result.materialId !== item.materialId) throw new Error("정리 응답의 요청이 달라요. 상태를 다시 확인해 주세요."); requestKey.current = null; setIssue(null); setUploadPhase("idle"); setMessage("요청한 임시 자료만 정리했어요. 새로 등록할 수 있어요."); }
    catch (error: unknown) { setFailure(errorText(error)); }
    finally { await finishOperation(); }
  }
  async function createCourse(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); if (!beginOperation()) return; const title: string = String(new FormData(event.currentTarget).get("courseTitle") ?? "");
    try { await materialJson("/api/materials/courses", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ title }) }); await refresh(); setMessage("과정을 만들었어요. 이 과정에 자료를 등록할 수 있어요."); }
    catch (error: unknown) { setFailure(errorText(error)); } finally { operation.current = false; setBusy(false); }
  }
  async function verifyStorage(): Promise<void> {
    if (!beginOperation()) return; setMessage("저장 공간을 확인하고 있어요…");
    try { inventoryReply.parse(await materialJson("/api/materials/storage-check", { method: "POST", signal: AbortSignal.timeout(30000) })); setMessage("실제 저장 공간과 쓰기·읽기를 확인했어요. 자료를 등록할 수 있어요."); }
    catch (error: unknown) { setFailure(errorText(error)); }
    finally { await finishOperation(); }
  }
  async function nextPage(): Promise<void> {
    if (!beginOperation()) return;
    try { const next: MaterialLibrary = await loadMaterialLibrary(library.cursor); setLibrary({ ...next, materials: [...library.materials, ...next.materials.filter((item): boolean => !library.materials.some((existing): boolean => existing.id === item.id))] }); setListFresh(true); if (next.hidden) setSelected(null); }
    catch (error: unknown) { setFailure(errorText(error)); setListFresh(false); }
    finally { operation.current = false; setBusy(false); }
  }

  const uploadAvailability: ActionAvailability = busy ? { kind: "busy", reason: "현재 요청을 확인하고 있어요." } : !listFresh ? { kind: "blocked", reason: "목록 조회가 확인되지 않았어요. 목록 새로 확인을 눌러 주세요." } : library.pending.length > 0 ? { kind: "blocked", reason: "아래 확인이 필요한 자료에서 기존 요청을 먼저 확인해 주세요." } : library.usage === null || library.usage.blocked ? { kind: "blocked", reason: "저장 공간 확인이 필요해요. 원본과 예약 상태를 확인한 뒤 등록할 수 있어요." } : library.courses.length === 0 ? { kind: "blocked", reason: "과정 이름을 먼저 만들어 주세요." } : { kind: "available" };
  return <div data-alter-ui className="material-library" data-detail={selected !== null} inert={!ready}><div className="material-summary"><p>원본을 모아 두고, 필요한 부분부터 차근차근 살펴보세요.</p><p>{library.usage === null ? "자료 저장 준비가 아직 완료되지 않았어요." : `${size(library.usage.occupiedBytes)} 사용 · ${size(library.usage.reservedBytes)} 예약 / 256 MiB`}</p></div><button type="button" disabled={busy || library.pending.length > 0} onClick={(): void => { void verifyStorage(); }}>저장 공간 확인</button>{(message || failure) && <div className="material-feedback" aria-live="polite"><p role="status">{message}</p>{failure && <p role="alert">{failure} <a href="/signin-with-chatgpt?return_to=/learn/materials">다시 로그인</a></p>}</div>}<div className="material-layout">{issue !== null && <div data-upload-issue={issue.kind}><ErrorState title={issue.title} detail={issue.detail} action={null} /></div>}{!listFresh && !busy && <ErrorState title="목록을 새로 확인하지 못했어요" detail="아래는 마지막으로 확인한 목록이에요. 새로 조회하기 전에는 원본을 열거나 새로 등록할 수 없어요." action={null} />}<Disclosure title="새 자료 등록" open={registrationOpen} onOpenChange={setRegistrationOpen}><RegistrationForm library={library} formRef={form} inputKind={inputKind} busy={busy} canStop={busy && (uploadPhase === "transferring" || uploadPhase === "confirming")} availability={uploadAvailability} onInputKind={setInputKind} onUpload={upload} onCourse={createCourse} onStop={(): void => { abort.current?.abort(new Error("전송을 중단했어요. 상태를 확인해 주세요.")); }} /></Disclosure>{(registrationOpen || uploadPhase !== "idle") && <UploadProgress phase={uploadPhase} />}<section className="material-shelf" aria-label="나의 자료 목록">{selected && !library.hidden && <SourcePreview key={selected.id} material={selected} previewRef={preview} onReturnToList={returnToList} />}<div hidden={selected !== null}><div className="material-section-heading"><h2 id="material-list-heading" tabIndex={-1}>나의 자료 <span>현재 {library.materials.length}개{library.hasMore ? " · 더 있음" : ""}</span></h2><button type="button" disabled={busy} onClick={(): void => { void refreshList(); }}>목록 새로 확인</button></div>{library.hidden && <p role="status" className="material-hidden">자료를 가리고 답하는 중이에요. 답안을 제출한 뒤 원본을 열 수 있어요.</p>}{library.pending.length > 0 && <PendingMaterials items={library.pending} busy={busy} onRecover={recover} onCleanup={cleanup} />}{library.materials.length === 0 && listFresh ? <div className="material-empty"><p className="eyebrow">첫 번째 자료</p><h3>배울 내용을 한곳에</h3><p>교재나 사진, 정리한 문장을 등록하면<br />여기에서 원본을 다시 볼 수 있어요.</p></div> : <MaterialList materials={library.materials} selectedId={selected?.id ?? null} unavailable={library.hidden || busy || !listFresh} onSelect={openMaterial} />}{library.hasMore && <button type="button" disabled={busy} onClick={(): void => { void nextPage(); }}>자료 더 보기</button>}</div></section></div></div>;
}
