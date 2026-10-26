"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { clientReady, serverReady, subscribeToHydration } from "@/lib/client-ready";

type ProbeResult = Readonly<{ id: string; status: number; result: unknown }>;
export type ContentCheckCase = Readonly<{ id: string; url: string; bytes: number; sha256: string; requireResult: (status: number, value: unknown) => void }>;
type ContentCheckSuite = Readonly<{ id: string; title: string; subject: string; mime: string; header: string; endpoint: string; cases: readonly ContentCheckCase[] }>;
export function MaterialContentCheck({ suite }: Readonly<{ suite: ContentCheckSuite }>): ReactElement {
  const ready: boolean = useSyncExternalStore(subscribeToHydration, clientReady, serverReady);
  const running = useRef<boolean>(false);
  const [message, setMessage] = useState<string>(`준비된 ${suite.subject}로 최대 크기 처리와 손상 파일 거부를 확인합니다.`);
  const [results, setResults] = useState<readonly ProbeResult[]>([]);
  const [pending, setPending] = useState<boolean>(false);
  const [failed, setFailed] = useState<boolean>(false);
  async function check(): Promise<void> {
    if (!ready || running.current) return;
    running.current = true; setPending(true); setFailed(false); setResults([]);
    const completed: ProbeResult[] = [];
    try {
      for (const fixture of suite.cases) {
        setMessage(`${suite.subject} 검증을 확인하고 있어요. ${completed.length + 1}/${suite.cases.length}`);
        const source: Response = await fetch(fixture.url, { credentials: "same-origin", signal: AbortSignal.timeout(20_000) });
        if (!source.ok) throw new Error(`검사 ${suite.subject} 읽기 실패: ${fixture.id}, HTTP ${source.status}`);
        const bytes: ArrayBuffer = await source.arrayBuffer();
        const digest: ArrayBuffer = await crypto.subtle.digest("SHA-256", bytes);
        const sha256: string = Array.from(new Uint8Array(digest), (byte: number): string => byte.toString(16).padStart(2, "0")).join("");
        if (bytes.byteLength !== fixture.bytes || sha256 !== fixture.sha256) throw new Error(`검사 ${suite.subject}가 원본과 다릅니다: ${fixture.id}`);
        const response: Response = await fetch(suite.endpoint, { method: "POST", credentials: "same-origin", headers: { "Content-Type": suite.mime, [suite.header]: fixture.id }, body: bytes, signal: AbortSignal.timeout(90_000) });
        const result: unknown = await response.json();
        fixture.requireResult(response.status, result);
        completed.push({ id: fixture.id, status: response.status, result }); setResults([...completed]);
      }
      setMessage(`${completed.length}개 ${suite.subject} 검사를 통과했어요. 자료 보관함에서 자료를 등록하고 원본을 확인할 수 있어요.`);
    } catch (error: unknown) {
      setFailed(true); setMessage(error instanceof Error ? `검사를 중단했어요. ${error.message}` : "검사를 중단했어요. 응답을 확인할 수 없습니다.");
    } finally { running.current = false; setPending(false); }
  }
  return <details className="storage-check"><summary>{suite.title}</summary>
    <button type="button" className="storage-check-button" disabled={!ready || pending} onClick={check} aria-describedby={suite.id}>{pending ? `${suite.subject} 확인 중…` : `${suite.title} 확인`}</button>
    <p id={suite.id} className="storage-check-result" role={failed ? "alert" : "status"} aria-atomic="true">{message}</p>
    {results.length > 0 && <details><summary>{suite.subject} 검사 결과</summary><pre style={{ overflowX: "auto", maxHeight: "24rem" }}>{JSON.stringify(results, null, 2)}</pre></details>}
  </details>;
}
