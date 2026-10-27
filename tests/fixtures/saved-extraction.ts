import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { selectionInput } from "../../lib/extraction/selection";
import { storedExtractionPage } from "../../lib/extraction/state";
import type { MaterialCard, MaterialLibrary } from "../../lib/materials/library";

const manifestEntry = z.object({ label: z.string().regex(/^[a-z0-9-]+$/), title: z.string().min(1), pdfPath: z.string().startsWith("/"), pageCount: z.number().int().positive(), snapshotPath: z.string().startsWith("/"), snapshotHash: z.string().regex(/^[a-f0-9]{64}$/), expectedVersions: z.array(z.number().int().positive()).min(1), expectedConfirmed: z.array(z.number().int().nonnegative()).min(1) }).strict();
const snapshotSchema = z.object({ job: z.object({ jobId: z.string().uuid(), revision: z.number().int().positive(), uploadId: z.string().uuid(), selection: selectionInput }).strict(), pages: z.array(storedExtractionPage).min(1) }).strict();
export type SavedExtractionEntry = Readonly<z.infer<typeof manifestEntry>>;
export type SavedExtractionSnapshot = Readonly<z.infer<typeof snapshotSchema>>;
export type SavedExtractionFixture = Readonly<{ entry: SavedExtractionEntry; snapshot: SavedExtractionSnapshot; pdf: Buffer; library: MaterialLibrary; material: MaterialCard }>;

/** 비공개 본문은 저장소에 넣지 않고 명시한 로컬 목록에서만 읽습니다. */
export function savedExtractionEntries(path: string | undefined): readonly SavedExtractionEntry[] {
  if (path === undefined) throw new Error("ALTER_EXTRACTION_REPLAY_MANIFEST에 원본·저장 결과 검증 목록의 절대 경로를 지정해 주세요.");
  if (!path.startsWith("/")) throw new Error("검증 목록 경로는 절대 경로여야 합니다.");
  return z.array(manifestEntry).min(1).parse(JSON.parse(readFileSync(path, "utf8")));
}

export function loadSavedExtraction(entry: SavedExtractionEntry): SavedExtractionFixture {
  const raw: Buffer = readFileSync(entry.snapshotPath);
  if (createHash("sha256").update(raw).digest("hex") !== entry.snapshotHash) throw new Error(`저장 결과가 검증 목록과 다릅니다: ${entry.label}`);
  const snapshot: SavedExtractionSnapshot = snapshotSchema.parse(JSON.parse(raw.toString("utf8")));
  const pdf: Buffer = readFileSync(entry.pdfPath); const binding = snapshot.job.selection;
  if (createHash("sha256").update(pdf).digest("hex") !== binding.originalHash) throw new Error(`등록 당시 원본과 PDF 해시가 다릅니다: ${entry.label}`);
  if (snapshot.pages.length !== binding.pages.length || snapshot.pages.length !== entry.expectedVersions.length || snapshot.pages.length !== entry.expectedConfirmed.length) throw new Error(`선택 페이지 개수가 일치하지 않습니다: ${entry.label}`);
  for (const [index, page] of snapshot.pages.entries()) {
    if (page.jobId !== snapshot.job.jobId || page.selectionRevision !== snapshot.job.revision || !binding.pages.some((selected): boolean => selected.filePage === page.filePage) || page.filePage > entry.pageCount || page.result?.filePage !== page.filePage || page.resultVersion !== entry.expectedVersions[index] || page.confirmedSegmentIds.length !== entry.expectedConfirmed[index]) throw new Error(`페이지·결과 판·확인 상태가 일치하지 않습니다: ${entry.label}/${page.filePage}`);
  }
  const courseId: string = "00000000-0000-4000-a000-000000000001";
  const material: MaterialCard = { id: binding.materialId, courseId, metadata: { title: entry.title, edition: "저장된 결과의 로컬 비교 검증", role: "reference", kind: "pdf", filename: `${entry.label}.pdf`, mime: "application/pdf", bytes: pdf.length, sha256: binding.originalHash }, file: { materialId: binding.materialId, kind: "pdf", role: "reference", bytes: pdf.length, pages: entry.pageCount, sha256: binding.originalHash, objectVersion: binding.originalVersion, sourceUrl: `/api/materials/${binding.materialId}/file` } };
  return { entry, snapshot, pdf, material, library: { materials: [material], courses: [{ id: courseId, title: "저장 결과 비교" }], pending: [], usage: null, hidden: false, hasMore: false, cursor: null } };
}
