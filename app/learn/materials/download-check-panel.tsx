"use client";

import { useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { subscribeToHydration, clientReady, serverReady } from "@/lib/client-ready";
import { checkSavedMaterialDownload } from "./download-check";
import type { DownloadCheckProof } from "./download-check";
import { errorText } from "./client-api";

export function MaterialDownloadCheck(): ReactElement {
  const ready: boolean = useSyncExternalStore(subscribeToHydration, clientReady, serverReady);
  const [busy, setBusy] = useState<boolean>(false);
  const [proof, setProof] = useState<DownloadCheckProof | null>(null);
  const [failure, setFailure] = useState<string>("");
  async function run(): Promise<void> {
    setBusy(true); setProof(null); setFailure("");
    try { setProof(await checkSavedMaterialDownload()); }
    catch (error: unknown) { setFailure(errorText(error)); }
    finally { setBusy(false); }
  }
  return <details className="storage-check" inert={!ready}><summary>원본 다운로드 중단·재개 확인</summary><p>이미 등록된 20MiB 합성 시험 PDF를 일부 받은 뒤 취소하고 이어받아요. 원본 해시와 자료 목록을 비교하며 새 자료 등록·삭제·AI 호출은 없어요.</p><button disabled={!ready || busy} onClick={(): void => { void run(); }}>저장된 시험 원본으로 읽기 검사</button><p role="status">{busy ? "원본 취소·이어받기·해시를 확인하고 있어요." : proof ? "원본 중단·이어받기·재조회와 자료 목록 보존을 확인했어요." : ""}</p>{failure && <p role="alert">{failure}</p>}{proof && <pre aria-label="원본 다운로드 검사 결과">{JSON.stringify(proof, null, 2)}</pre>}</details>;
}
