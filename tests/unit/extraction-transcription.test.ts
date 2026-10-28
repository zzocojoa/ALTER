import { expect, it } from "vitest";
import { initialTranscription, transcriptionEntry, transcriptionInput } from "../../lib/extraction/transcription";
import type { TranscriptionInput } from "../../lib/extraction/transcription";
import { correctedPage } from "../../lib/extraction/confirmation";
import { completedResultDraft, correctionOf, emptyResultDraft, replaceCorrection } from "../../app/learn/materials/result-draft";
import { pageSaveAttempt, pageSavePayload, savedPageMatches } from "../../app/learn/materials/page-save";
import type { StoredExtractionPage } from "../../lib/extraction/state";

const id: string = "00000000-0000-4000-a000-000000000801";
const nextId: string = "00000000-0000-4000-a000-000000000802";
const pending: StoredExtractionPage = { id, jobId: id, selectionRevision: 1, filePage: 2, version: 1, resultId: null, resultVersion: 0, state: "pending", printedPage: null, pendingAiKey: null, pendingImage: null, resultImage: null, failure: null, confirmedSegmentIds: [], result: null };
const input: TranscriptionInput = { intent: "transcribe", selectionRevision: 1, filePage: 2, expectedVersion: 1, resultId: null, segments: [{ id: "s0", text: "원본을 보고 적은 문장" }] };
const saved: StoredExtractionPage = { ...pending, version: 2, state: "complete", resultId: nextId, resultVersion: 1, result: initialTranscription(input) };

it("결과 없는 전사는 저장 결과를 꾸미지 않고 로컬 초안만 만든다", (): void => {
  const draft = correctionOf(pending, emptyResultDraft);
  expect(draft).toEqual({ resultId: null, resultVersion: 0, segments: [{ id: "s0", text: "" }] });
  expect(pending.result).toBeNull(); expect(pending.state).toBe("pending");
  const changed = replaceCorrection(pending, emptyResultDraft, "s0", "전사 초안");
  expect(changed.correction?.segments[0].text).toBe("전사 초안"); expect(emptyResultDraft.correction).toBeNull();
});
it("전사 진입은 처리 중 보호와 기존 결과 보존을 우선한다", (): void => {
  expect(transcriptionEntry(pending)).toBe("create"); expect(transcriptionEntry({ ...pending, state: "failed" })).toBe("create");
  expect(transcriptionEntry(saved)).toBe("edit"); expect(transcriptionEntry({ ...saved, state: "failed" })).toBe("edit");
  for (const state of ["running", "unknown"] as const) for (const page of [pending, saved]) expect(transcriptionEntry({ ...page, state })).toBe("recover");
  expect(transcriptionEntry({ ...pending, state: "complete" })).toBe("unavailable");
  if (saved.result === null) throw new Error("합성 전사 결과가 없어요.");
  for (const status of ["blank", "no-text", "unreadable"] as const) expect(transcriptionEntry({ ...saved, result: { ...saved.result, status, segments: [] } })).toBe("edit");
  expect(transcriptionEntry({ ...saved, state: "failed", result: { ...saved.result, status: "failed", segments: [], error: "합성 실패" } })).toBe("create");
});
it("첫 전사는 내용과 선택 바인딩을 명시하고 좌표를 추정하지 않는다", (): void => {
  const result = initialTranscription(input);
  expect(result).toMatchObject({ method: "manual-correction", status: "complete", requiresConfirmation: true, width: null, height: null, rotation: 0 });
  expect(result.segments[0]).toMatchObject({ text: input.segments[0].text, uncertain: true, bounds: null, transform: null });
  for (const segments of [[], [{ id: "s1", text: "내용" }], [{ id: "s0", text: " \n\t " }], [{ id: "s0", text: "a".repeat(60001) }]]) expect(transcriptionInput.safeParse({ ...input, segments }).success).toBe(false);
});
it("초기 저장 의도는 기존 수정과 구분되고 저장 판과 내용까지 대조한다", (): void => {
  const attempt = pageSaveAttempt(pending, { kind: "transcribe", segments: input.segments }, "initial-key");
  expect(pageSavePayload(attempt)).toEqual(input); expect(savedPageMatches(saved, attempt)).toBe(true);
  expect(savedPageMatches({ ...saved, version: 1 }, attempt)).toBe(false);
  expect(() => savedPageMatches({ ...saved, filePage: 3 }, attempt)).toThrow();
  if (saved.result === null) throw new Error("합성 전사 결과가 없어요.");
  expect(savedPageMatches({ ...saved, result: { ...saved.result, method: "vision" } }, attempt)).toBe(false);
  const draft = replaceCorrection(pending, emptyResultDraft, "s0", input.segments[0].text);
  expect(completedResultDraft(draft, attempt, "저장 확인").correction).toBeNull();
  expect(completedResultDraft(replaceCorrection(pending, draft, "s0", "저장 중 새로 쓴 초안"), attempt, "저장 확인").correction?.segments[0].text).toBe("저장 중 새로 쓴 초안");
});
it("기존 결과 수정은 식별자와 내용을 보존하고 불명·빈 내용·오래된 판은 거부한다", (): void => {
  expect(correctionOf(saved, emptyResultDraft).segments).toEqual(input.segments);
  const edit = { selectionRevision: 1, filePage: 2, expectedVersion: 2, resultId: nextId, segments: [{ id: "s0", text: "수정 문장" }] };
  const corrected = correctedPage(saved, edit);
  expect(corrected.segments[0].text).toBe("수정 문장"); expect(corrected.requiresConfirmation).toBe(true);
  expect(correctedPage({ ...saved, state: "failed" }, edit).segments[0].text).toBe("수정 문장");
  for (const state of ["running", "unknown", "pending"] as const) expect(() => correctedPage({ ...saved, state }, edit)).toThrow();
  expect(() => correctedPage(saved, { ...edit, resultId: id })).toThrow();
  expect(() => correctedPage(saved, { ...edit, segments: [{ id: "s0", text: "  " }] })).toThrow();
});

it("빈 결과나 텍스트층 없는 기존 판은 s0 전사로 수정하며 확인이 필요하다", (): void => {
  if (saved.result === null) throw new Error("합성 원문이 없습니다.");
  for (const status of ["blank", "no-text"] as const) {
    const empty: StoredExtractionPage = { ...saved, result: { ...saved.result, method: "text-layer", status, width: 100, height: 100, segments: [] } };
    const result = correctedPage(empty, { selectionRevision: 1, filePage: 2, expectedVersion: 2, resultId: nextId, segments: [{ id: "s0", text: "원본을 대조한 전사" }] });
    expect(result.status).toBe("complete"); expect(result.method).toBe("manual-correction"); expect(result.requiresConfirmation).toBe(true); expect(result.segments[0].uncertain).toBe(true);
  }
});

it("기존 결과의 일부 구간만 비워도 나머지 내용은 보존한다", (): void => {
  if (saved.result === null) throw new Error("합성 원문이 없습니다.");
  const original: StoredExtractionPage = { ...saved, result: { ...saved.result, segments: [...saved.result.segments, { ...saved.result.segments[0], id: "s1", text: "보존할 두 번째 구간" }] } };
  const result = correctedPage(original, { selectionRevision: 1, filePage: 2, expectedVersion: 2, resultId: nextId, segments: [{ id: "s0", text: "" }] });
  expect(result.segments.map((segment): string => segment.text)).toEqual(["", "보존할 두 번째 구간"]);
});
