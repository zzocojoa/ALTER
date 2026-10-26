import { sha256 } from "@noble/hashes/sha2.js";
import type { MaterialFileReference } from "@/lib/materials/attachment";
import type { MaterialLibrary } from "@/lib/materials/library";
import { loadMaterialLibrary, requireMaterialResponse } from "./client-api";

export type DownloadReadProof = Readonly<{ materialId: string; originalBytes: number; bytesBeforeCancellation: number; resumedBytes: number; sha256: string; etag: string; maximumReadBufferBytes: number }>;
export type DownloadCheckProof = DownloadReadProof & Readonly<{ status: "passed"; checkedAt: string; libraryPagesUnchanged: true; materialCount: number; pendingCount: number; newUploads: 0; aiCalls: 0 }>;
const bufferBytes: number = 65_536;
const fixedHash: string = "cabdcdf96d66c1a791d0f08c2a01f66b75bc2ecbfa43d97c1ab313d862dfd818";

function ensure(condition: boolean, stage: string): asserts condition {
  if (!condition) throw Object.assign(new Error(`원본 다운로드 확인 실패: ${stage}. 자료 상태를 다시 확인해 주세요.`), { name: "MaterialDownloadCheckFailure" });
}
async function getOriginal(file: MaterialFileReference, headers: Readonly<Record<string, string>>): Promise<Response> {
  const response: Response = await fetch(`/api/materials/${file.materialId}/file`, { method: "GET", credentials: "same-origin", cache: "no-store", headers, signal: AbortSignal.timeout(120_000) });
  await requireMaterialResponse(response);
  return response;
}
function byteReader(response: Response): ReadableStreamBYOBReader {
  if (response.body === null) throw new Error("다운로드 응답에 원본 스트림이 없습니다.");
  try { return response.body.getReader({ mode: "byob" }); }
  catch (error: unknown) {
    if (!(error instanceof TypeError)) throw error;
    throw new Error("이 브라우저에서는 제한된 버퍼의 다운로드 검사를 실행할 수 없습니다.", { cause: error });
  }
}
/** 이미 받은 앞부분과 이어받은 본문을 64KiB씩 해시하며 전체 원본을 쌓지 않습니다. */
async function verifyRemaining(response: Response, prefix: Uint8Array, file: MaterialFileReference): Promise<number> {
  const reader: ReadableStreamBYOBReader = byteReader(response);
  const hash: ReturnType<typeof sha256.create> = sha256.create().update(prefix);
  let bytes: number = prefix.byteLength;
  try {
    while (true) {
      const part = await reader.read(new Uint8Array(bufferBytes));
      if (part.done) break;
      bytes += part.value.byteLength;
      ensure(bytes <= file.bytes, `received-bytes:${bytes}/expected:${file.bytes}`);
      hash.update(part.value);
    }
    ensure(bytes === file.bytes, `received-bytes:${bytes}/expected:${file.bytes}`);
    const actual: string = Array.from(hash.digest(), (value: number): string => value.toString(16).padStart(2, "0")).join("");
    ensure(actual === file.sha256, "sha256-mismatch");
    return bytes - prefix.byteLength;
  } catch (error: unknown) {
    try { await reader.cancel(error); }
    catch (cleanup: unknown) { throw new AggregateError([error, cleanup], "다운로드 검증과 스트림 종료에 실패했습니다."); }
    throw error;
  } finally { reader.releaseLock(); }
}
/** 소유자의 정상 원본 API만 호출하여 일부 수신 취소·Range 재개·새 전체 조회를 대조합니다. */
export async function verifyMaterialDownload(file: MaterialFileReference): Promise<DownloadReadProof> {
  const first: Response = await getOriginal(file, {});
  const etag: string | null = first.headers.get("etag");
  const reader: ReadableStreamBYOBReader = byteReader(first);
  let prefix: Uint8Array;
  try {
    ensure(first.status === 200 && etag !== null, `initial-status:${first.status}/etag:${etag !== null}`);
    const part = await reader.read(new Uint8Array(bufferBytes));
    ensure(!part.done && part.value !== undefined && part.value.byteLength > 0 && part.value.byteLength < file.bytes, "partial-read-required");
    prefix = part.value;
  } finally {
    try { await reader.cancel("고정 시험 원본의 일부 수신 후 취소"); }
    finally { reader.releaseLock(); }
  }
  ensure(etag !== null, "etag-required");
  const resumed: Response = await getOriginal(file, { range: `bytes=${prefix.byteLength}-`, "if-range": etag });
  try {
    ensure(resumed.status === 206, `resume-status:${resumed.status}`);
    ensure(resumed.headers.get("etag") === etag, "resume-etag-changed");
    ensure(resumed.headers.get("content-range") === `bytes ${prefix.byteLength}-${file.bytes - 1}/${file.bytes}`, "resume-content-range");
  } catch (error: unknown) { await resumed.body?.cancel(error); throw error; }
  const resumedBytes: number = await verifyRemaining(resumed, prefix, file);
  const fresh: Response = await getOriginal(file, {});
  try { ensure(fresh.status === 200 && fresh.headers.get("etag") === etag, `fresh-status:${fresh.status}/etag-match:${fresh.headers.get("etag") === etag}`); }
  catch (error: unknown) { await fresh.body?.cancel(error); throw error; }
  await verifyRemaining(fresh, new Uint8Array(), file);
  return { materialId: file.materialId, originalBytes: file.bytes, bytesBeforeCancellation: prefix.byteLength, resumedBytes, sha256: file.sha256, etag, maximumReadBufferBytes: bufferBytes };
}
async function allLibraryPages(): Promise<readonly MaterialLibrary[]> {
  const pages: MaterialLibrary[] = [];
  let cursor: string | null = null;
  do {
    const page: MaterialLibrary = await loadMaterialLibrary(cursor);
    pages.push(page);
    if (!page.hasMore) return pages;
    ensure(page.cursor !== null && page.cursor !== cursor && !pages.slice(0, -1).some((known: MaterialLibrary): boolean => known.cursor === page.cursor), "library-pagination");
    cursor = page.cursor;
  } while (true);
}
/** 저장된 고정 합성 PDF만 선택하고 등록·삭제·AI 요청은 만들지 않습니다. */
export async function checkSavedMaterialDownload(): Promise<DownloadCheckProof> {
  const before: readonly MaterialLibrary[] = await allLibraryPages();
  const materials = before.flatMap((page: MaterialLibrary) => page.materials);
  const fixed = materials.find((item): boolean => item.metadata.title === "검증 20MiB PDF" && item.metadata.edition === "검증용 합성 자료" && item.metadata.kind === "pdf" && item.metadata.bytes === 20_971_520 && item.metadata.sha256 === fixedHash && item.file.sha256 === fixedHash);
  if (!fixed) throw new Error("등록된 20MiB 고정 시험 PDF가 없습니다. 자료 등록 검증의 시험 자료를 먼저 준비해 주세요.");
  const proof: DownloadReadProof = await verifyMaterialDownload(fixed.file);
  const after: readonly MaterialLibrary[] = await allLibraryPages();
  ensure(JSON.stringify(before) === JSON.stringify(after), "library-changed-during-check");
  return { ...proof, status: "passed", checkedAt: new Date().toISOString(), libraryPagesUnchanged: true, materialCount: materials.length, pendingCount: before[0].pending.length, newUploads: 0, aiCalls: 0 };
}
