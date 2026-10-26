"use client";

import { useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { z } from "zod";
import { acceptanceBoundaryPdf } from "./acceptance-pdf";
import fixtures from "./acceptance-fixtures.json";
import { errorText, materialJson, transferReply } from "./client-api";
import { materialMetadata } from "@/lib/materials/policy";
import type { MaterialMetadata } from "@/lib/materials/policy";
import { subscribeToHydration, clientReady, serverReady } from "@/lib/client-ready";

type Check = Readonly<{ name: string; status: "passed"; bytes?: number; httpStatus?: number }>;
type Transfer = z.infer<typeof transferReply>;
async function digest(bytes: Uint8Array<ArrayBuffer>): Promise<string> { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte: number): string => byte.toString(16).padStart(2, "0")).join(""); }
function ensure(condition: boolean, operation: string): void { if (!condition) throw new Error(`운영 자료 검사 실패: ${operation}`); }
async function jsonPost(url: string, value: object): Promise<unknown> { return materialJson(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) }); }
async function start(courseId: string, metadata: MaterialMetadata, key: string): Promise<Transfer> { return transferReply.parse(await materialJson("/api/materials/uploads", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify({ courseId, metadata }) })); }
async function clean(transfer: Transfer): Promise<void> { const current = transferReply.parse(await materialJson(`/api/materials/uploads/${transfer.id}`, { method: "GET" })); await jsonPost(`/api/materials/uploads/${transfer.id}/cleanup`, { expectedVersion: current.version }); }
async function verifyRead(transfer: Transfer, bytes: Uint8Array<ArrayBuffer>, metadata: MaterialMetadata): Promise<Check[]> {
  const url: string = `/api/materials/${transfer.materialId}/file`;
  const full: Response = await fetch(url, { cache: "no-store" });
  ensure(full.status === 200 && await digest(new Uint8Array(await full.arrayBuffer())) === metadata.sha256, "full-original-sha256");
  const head: Response = await fetch(url, { method: "HEAD", cache: "no-store" });
  ensure(head.status === 200 && Number(head.headers.get("content-length")) === bytes.length && head.headers.get("cache-control")?.includes("no-store") === true, "head-private-length");
  const part: Response = await fetch(url, { headers: { range: "bytes=0-15" }, cache: "no-store" });
  const range: Uint8Array = new Uint8Array(await part.arrayBuffer());
  ensure(part.status === 206 && range.length === 16 && range.every((byte: number, index: number): boolean => byte === bytes[index]) && part.headers.get("content-range") === `bytes 0-15/${bytes.length}`, "range-original-bytes");
  const invalid: Response = await fetch(url, { headers: { range: `bytes=${bytes.length}-` }, cache: "no-store" });
  ensure(invalid.status === 416, "range-outside-rejected");
  return [{ name: `${metadata.title}: 원본 SHA-256·HEAD·206·416`, status: "passed", bytes: bytes.length, httpStatus: 206 }];
}

/** 고정된 공개 합성 파일로 실제 제품 API를 검사하며 확정 자료와 다른 사용자 자료는 삭제하지 않습니다. */
export function MaterialAcceptanceCheck(): ReactElement {
  const ready: boolean = useSyncExternalStore(subscribeToHydration, clientReady, serverReady);
  const [busy, setBusy] = useState<boolean>(false);
  const [message, setMessage] = useState<string>("");
  const [failure, setFailure] = useState<string>("");
  const [checks, setChecks] = useState<readonly Check[]>([]);
  async function run(): Promise<void> {
    setBusy(true); setChecks([]); setFailure("");
    const results: Check[] = [];
    try {
      await materialJson("/api/materials/storage-check", { method: "POST" });
      results.push({ name: "실제 R2 전체 대사·쓰기·읽기·정리", status: "passed" });
      const courseId: string = crypto.randomUUID();
      await materialJson("/api/materials/courses", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": courseId }, body: JSON.stringify({ title: `자료 기능 검증 ${new Date().toISOString()}` }) });
      for (const fixture of [...fixtures, { title: "20MiB PDF", kind: "pdf", mime: "application/pdf", filename: "20mib.pdf", base64: null }]) {
        setMessage(`${fixture.title} 등록·원본·부분 읽기 확인 중`);
        const bytes: Uint8Array<ArrayBuffer> = fixture.base64 === null ? acceptanceBoundaryPdf(20971520) : Uint8Array.from(atob(fixture.base64), (char: string): number => char.charCodeAt(0));
        const metadata: MaterialMetadata = materialMetadata.parse({ title: `검증 ${fixture.title}`, edition: "검증용 합성 자료", role: "reference", kind: fixture.kind, mime: fixture.mime, filename: fixture.filename, bytes: bytes.length, sha256: await digest(bytes) });
        const key: string = crypto.randomUUID();
        const pair: Transfer[] = await Promise.all([start(courseId, metadata, key), start(courseId, metadata, key)]);
        ensure(pair[0].id === pair[1].id, "concurrent-start-idempotency");
        const uploaded = transferReply.parse(await materialJson(`/api/materials/uploads/${pair[0].id}/body`, { method: "PUT", headers: { "content-type": metadata.mime, "x-upload-version": String(pair[0].version) }, body: bytes }));
        const completed = transferReply.parse(await jsonPost(`/api/materials/uploads/${uploaded.id}/complete`, { expectedVersion: uploaded.version }));
        ensure(completed.state === "registered", "content-registration");
        results.push(...await verifyRead(completed, bytes, metadata)); setChecks([...results]);
      }
      const bytes: Uint8Array<ArrayBuffer> = new TextEncoder().encode("중단과 예약 검증 원본");
      const metadata: MaterialMetadata = materialMetadata.parse({ title: "검증 중단 자료", edition: "", role: "reference", kind: "text", mime: "text/plain", filename: "interrupted.txt", bytes: bytes.length, sha256: await digest(bytes) });
      setMessage("중단·재개·정리와 크기 제한 확인 중");
      const reserved: Transfer = await start(courseId, metadata, crypto.randomUUID());
      const recover = z.object({ nextAction: z.string() }).passthrough().parse(await jsonPost(`/api/materials/uploads/${reserved.id}/recover`, { expectedVersion: reserved.version }));
      ensure(recover.nextAction === "upload", "reserved-resume");
      const short: Response = await fetch(`/api/materials/uploads/${reserved.id}/body`, { method: "PUT", headers: { "content-type": "text/plain", "x-upload-version": String(reserved.version) }, body: bytes.slice(0, 8) });
      ensure([400, 422].includes(short.status), "short-body-rejected");
      await clean(reserved);
      results.push({ name: "예약 재개·짧은 원본 거부·임시 자료 정리", status: "passed", httpStatus: short.status });
      const incorrect = await start(courseId, { ...metadata, sha256: "0".repeat(64) }, crypto.randomUUID());
      const mismatch: Response = await fetch(`/api/materials/uploads/${incorrect.id}/body`, { method: "PUT", headers: { "content-type": "text/plain", "x-upload-version": String(incorrect.version) }, body: bytes });
      ensure(mismatch.status === 422, "checksum-rejected-after-stream");
      await clean(incorrect);
      results.push({ name: "전체 전송 후 SHA-256 불일치 거부·예약 유지·정리", status: "passed", httpStatus: 422 });
      const exceeded: Response = await fetch("/api/materials/uploads", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ courseId, metadata: { ...metadata, bytes: 1048577 } }) });
      ensure(exceeded.status === 413, "size-limit-before-write");
      results.push({ name: "텍스트 1MiB 초과 예약 거부", status: "passed", httpStatus: 413 });
      const missing: Response = await fetch(`/api/materials/${crypto.randomUUID()}/file`, { cache: "no-store" });
      ensure(missing.status === 404, "unregistered-material-denied");
      results.push({ name: "존재하지 않는 확정 자료 접근 거부", status: "passed", httpStatus: 404 });
      await materialJson("/api/materials/storage-check", { method: "POST" });
      results.push({ name: "등록 후 R2 원본 버전·용량 재대사", status: "passed" });
      setChecks([...results]); setMessage(`${results.length}개 운영 자료 검사를 통과했어요. 검증용 과정에서 원본을 확인할 수 있어요.`);
    } catch (error: unknown) { setChecks([...results]); setFailure(errorText(error)); setMessage("검사를 중단했어요. 자료 보관함에서 미확정 자료 상태를 확인해 주세요."); }
    finally { setBusy(false); }
  }
  return <details className="storage-check" inert={!ready}><summary>자료 등록 기능 확인</summary><p>고정된 합성 자료 6개를 검증용 과정에 등록하고 원본·부분 읽기·중단 정리를 확인해요. AI 호출은 없어요.</p><button type="button" disabled={!ready || busy} onClick={(): void => { void run(); }}>운영 자료 검사 실행</button><p role="status">{message}</p>{failure && <p role="alert">{failure}</p>}<pre aria-label="자료 등록 검사 결과">{JSON.stringify({ checks, passed: checks.length, failure: failure || null, actualProductApis: true, aiCalls: 0 }, null, 2)}</pre></details>;
}
