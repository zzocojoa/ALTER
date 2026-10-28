import { beginVisionExtraction, getExtractionPage, recordVisionFailure, saveExtractionCorrection, saveInitialTranscription, saveTextExtraction } from "../../db/repositories/extraction-pages";
import { confirmExtractionSegments } from "../../db/repositories/extraction-confirmations";
import type { VerifiedExtractionPage } from "../../lib/extraction/server";
import type { ImageMetadata, StoredExtractionPage } from "../../lib/extraction/state";
import type { TranscriptionInput } from "../../lib/extraction/transcription";

function check(value: boolean, message: string): void { if (!value) throw new Error(message); }
async function rejected(action: () => Promise<unknown>): Promise<void> {
  let failure: unknown;
  try { await action(); } catch (error: unknown) { failure = error; }
  check(failure instanceof Error, "거부되어야 하는 전사가 저장됐어요.");
}
export async function checkTranscriptionState(db: D1Database, proof: VerifiedExtractionPage, page: StoredExtractionPage): Promise<readonly string[]> {
  const owner = proof.owner;
  const input: TranscriptionInput = { intent: "transcribe", selectionRevision: page.selectionRevision, filePage: page.filePage, expectedVersion: page.version, resultId: null, segments: [{ id: "s0", text: "초기 전사 합성 내용" }] };
  const command = { owner, expectedVersion: page.version, requestKey: crypto.randomUUID() };
  await rejected(() => saveInitialTranscription(db, { ...command, owner: { ...owner, userId: "another-owner" } }, proof, page, input));
  await rejected(() => saveInitialTranscription(db, command, { ...proof, job: { ...proof.job, selection: { ...proof.job.selection, originalHash: "b".repeat(64) } } }, page, input));
  await rejected(() => saveInitialTranscription(db, command, proof, page, { ...input, segments: [{ id: "s0", text: " \n " }] }));
  check((await getExtractionPage(db, owner, page.id)).result === null, "거부된 저장이 결과를 만들었어요.");
  const receipt = await saveInitialTranscription(db, command, proof, page, input);
  const first = await getExtractionPage(db, owner, page.id);
  check(first.result?.method === "manual-correction" && first.resultVersion === 1 && first.result.segments[0].text === input.segments[0].text && first.confirmedSegmentIds.length === 0, "초기 전사가 영속 저장되지 않았어요.");
  check(JSON.stringify(await saveInitialTranscription(db, command, proof, first, input)) === JSON.stringify(receipt), "최신 페이지를 읽은 뒤 동일 초기 요청 재현에 실패했어요.");
  await rejected(() => saveInitialTranscription(db, command, proof, first, { ...input, segments: [{ id: "s0", text: "같은 키 다른 내용" }] }));
  await rejected(() => saveInitialTranscription(db, { ...command, expectedVersion: first.version, requestKey: crypto.randomUUID() }, proof, first, { ...input, expectedVersion: first.version, resultId: first.resultId }));
  if (first.resultId === null) throw new Error("실제 저장 결과 ID가 없어요.");
  const confirmation = { selectionRevision: page.selectionRevision, filePage: page.filePage, expectedVersion: first.version, resultId: first.resultId, segmentIds: ["s0"], printedPage: "iii", comparedWithOriginal: true as const };
  await confirmExtractionSegments(db, { owner, expectedVersion: first.version, requestKey: crypto.randomUUID() }, proof, first, confirmation);
  const confirmed = await getExtractionPage(db, owner, page.id);
  const edit = { selectionRevision: page.selectionRevision, filePage: page.filePage, expectedVersion: confirmed.version, resultId: first.resultId, segments: [{ id: "s0", text: "초기 전사의 수정 내용" }] };
  const editCommand = { owner, expectedVersion: confirmed.version, requestKey: crypto.randomUUID() };
  const editedReceipt = await saveExtractionCorrection(db, editCommand, proof, confirmed, edit);
  const edited = await getExtractionPage(db, owner, page.id);
  check(edited.result?.segments[0].text === edit.segments[0].text && edited.confirmedSegmentIds.length === 0, "수정이 저장되지 않았거나 이전 확인을 승계했어요.");
  check(JSON.stringify(await saveExtractionCorrection(db, editCommand, proof, edited, edit)) === JSON.stringify(editedReceipt), "기존 수정 재전송이 새 결과를 만들었어요.");
  await rejected(() => saveExtractionCorrection(db, editCommand, proof, edited, { ...edit, segments: [{ id: "s0", text: "동일 키 변경" }] }));
  await rejected(() => confirmExtractionSegments(db, { owner, expectedVersion: edited.version, requestKey: crypto.randomUUID() }, proof, edited, { ...confirmation, expectedVersion: edited.version }));
  const outcomes = await Promise.allSettled(["A", "B"].map((text: string) => saveExtractionCorrection(db, { owner, expectedVersion: edited.version, requestKey: crypto.randomUUID() }, proof, edited, { ...edit, expectedVersion: edited.version, resultId: edited.resultId!, segments: [{ id: "s0", text }] })));
  check(outcomes.filter((outcome): boolean => outcome.status === "fulfilled").length === 1, "동시 수정이 둘 다 저장됐어요.");
  const ready = await getExtractionPage(db, owner, page.id);
  const image: ImageMetadata = { mime: "image/png", bytes: 1, sha256: "b".repeat(64), width: 100, height: 100, sourceWidth: 100, sourceHeight: 100, rotation: 0, sourceToImage: [1, 0, 0, 1, 0, 0], coordinateSpace: "pdf-viewport" };
  await beginVisionExtraction(db, { owner, expectedVersion: ready.version, requestKey: crypto.randomUUID() }, proof, ready, "manual-preserve-unknown", image);
  const running = await getExtractionPage(db, owner, page.id);
  await rejected(() => saveExtractionCorrection(db, { owner, expectedVersion: running.version, requestKey: crypto.randomUUID() }, proof, running, { ...edit, expectedVersion: running.version, resultId: running.resultId! }));
  await recordVisionFailure(db, { owner, expectedVersion: running.version, requestKey: crypto.randomUUID() }, proof, running, "unknown", "합성 응답 불명");
  const unknown = await getExtractionPage(db, owner, page.id);
  await rejected(() => saveInitialTranscription(db, { owner, expectedVersion: unknown.version, requestKey: crypto.randomUUID() }, proof, unknown, { ...input, expectedVersion: unknown.version, resultId: unknown.resultId }));
  check((await getExtractionPage(db, owner, page.id)).resultId === ready.resultId, "불명 상태의 전사가 이전 결과를 덮었어요.");
  return ["manual-initial-persistence-owner-original-empty-guards", "manual-initial-and-edit-idempotent-after-fresh-read", "manual-existing-result-preserved-and-confirmation-invalidated", "manual-concurrent-edit-one-commit-and-stale-confirmation-denied", "manual-running-unknown-preserves-prior-result"];
}

export async function checkFailedTranscription(db: D1Database, proof: VerifiedExtractionPage, page: StoredExtractionPage): Promise<readonly string[]> {
  const owner = proof.owner;
  await saveTextExtraction(db, { owner, expectedVersion: page.version, requestKey: crypto.randomUUID() }, proof, page, { filePage: page.filePage, method: "text-layer", status: "failed", width: null, height: null, rotation: 0, segments: [], error: "합성 텍스트 읽기 실패", requiresConfirmation: true });
  const failed = await getExtractionPage(db, owner, page.id);
  const input: TranscriptionInput = { intent: "transcribe", selectionRevision: failed.selectionRevision, filePage: failed.filePage, expectedVersion: failed.version, resultId: failed.resultId, segments: [{ id: "s0", text: "실패 페이지 직접 전사" }] };
  const outcomes = await Promise.allSettled(["A", "B"].map((text: string) => saveInitialTranscription(db, { owner, expectedVersion: failed.version, requestKey: crypto.randomUUID() }, proof, failed, { ...input, segments: [{ id: "s0", text }] })));
  check(outcomes.filter((outcome): boolean => outcome.status === "fulfilled").length === 1, "동시 초기 전사가 둘 다 저장됐어요.");
  const saved = await getExtractionPage(db, owner, page.id);
  check(saved.resultVersion === 2 && saved.result?.method === "manual-correction" && saved.state === "complete" && saved.confirmedSegmentIds.length === 0, "실패 상태의 초기 전사가 저장되지 않았어요.");
  const old: string | null = await db.prepare("SELECT result FROM extraction_results WHERE owner_id=? AND id=?").bind(owner.userId, failed.resultId).first<string>("result");
  check(old !== null && JSON.parse(old).status === "failed", "이전 실패 기록이 사라졌어요.");
  return ["manual-failed-page-initial-concurrency-and-history-preserved"];
}
