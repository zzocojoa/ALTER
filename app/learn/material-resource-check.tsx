"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { clientReady, serverReady, subscribeToHydration } from "@/lib/client-ready";
import { materialPolicy } from "@/lib/materials/policy";
import type { MaterialKind } from "@/lib/materials/policy";

type ProbeResult = Readonly<{ kind: MaterialKind; bytes: number; status: number; result: unknown }>;
const probeTypes: readonly Readonly<{ kind: MaterialKind; filename: string; mime: string }>[] = [
  { kind: "text", filename: "probe.txt", mime: "text/plain" },
  { kind: "image", filename: "probe.png", mime: "image/png" },
  { kind: "pdf", filename: "probe.pdf", mime: "application/pdf" },
];

/** 업로드 한도 확인용 합성 바이트를 순차 전송하며 AI 호출이나 자료 등록은 실행하지 않습니다. */
export function MaterialResourceCheck(): ReactElement {
  const ready: boolean = useSyncExternalStore(subscribeToHydration, clientReady, serverReady);
  const running = useRef<boolean>(false);
  const [message, setMessage] = useState<string>("임시 전송 검사로 파일 크기와 저장소 읽기를 확인합니다. 검사 파일은 정리됩니다.");
  const [results, setResults] = useState<readonly ProbeResult[]>([]);
  const [pending, setPending] = useState<boolean>(false);
  const [failed, setFailed] = useState<boolean>(false);

  async function check(): Promise<void> {
    if (!ready || running.current) return;
    running.current = true;
    setPending(true);
    setFailed(false);
    setResults([]);
    const completed: ProbeResult[] = [];
    try {
      for (const fixture of probeTypes) {
        for (const offset of [-1, 0, 1]) {
          const bytes: number = materialPolicy.types[fixture.kind].maximumBytes + offset;
          setMessage(`임시 전송을 확인하고 있어요. ${completed.length + 1}/9`);
          const payload: Uint8Array<ArrayBuffer> = new Uint8Array(bytes);
          const digest: ArrayBuffer = await crypto.subtle.digest("SHA-256", payload);
          const sha256: string = Array.from(new Uint8Array(digest), (byte: number): string => byte.toString(16).padStart(2, "0")).join("");
          const response: Response = await fetch("/api/storage/material-check", { method: "POST", credentials: "same-origin", headers: {
            "Content-Type": "application/octet-stream", "x-probe-kind": fixture.kind, "x-probe-filename": fixture.filename,
            "x-probe-mime": fixture.mime, "x-probe-bytes": String(bytes), "x-probe-sha256": sha256,
          }, body: new Blob([payload]), signal: AbortSignal.timeout(120_000) });
          const result: unknown = await response.json();
          completed.push({ kind: fixture.kind, bytes, status: response.status, result });
          setResults([...completed]);
          if (response.status !== (offset === 1 ? 413 : 200)) throw new Error(`전송 검사 ${fixture.kind}/${bytes}: HTTP ${response.status}`);
        }
      }
      setMessage("9개 전송 검사를 마쳤어요. 파일 내용의 유효성과 계정 잔여 용량은 별도로 확인해야 합니다.");
    } catch (error: unknown) {
      setFailed(true);
      setMessage(error instanceof Error ? `검사를 중단했어요. ${error.message}` : "검사를 중단했어요. 응답을 확인할 수 없습니다.");
    } finally { running.current = false; setPending(false); }
  }

  return <details className="storage-check"><summary>자료 전송 환경</summary>
    <button type="button" className="storage-check-button" disabled={!ready || pending} onClick={check} aria-describedby="material-resource-result">{pending ? "전송 확인 중…" : "자료 전송 환경 확인"}</button>
    <p id="material-resource-result" className="storage-check-result" role={failed ? "alert" : "status"} aria-atomic="true">{message}</p>
    {results.length > 0 && <details><summary>전송 검사 결과</summary><pre style={{ overflowX: "auto", maxHeight: "24rem" }}>{JSON.stringify(results, null, 2)}</pre></details>}
  </details>;
}
