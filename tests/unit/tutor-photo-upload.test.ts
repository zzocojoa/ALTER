import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadTutorPhoto } from "../../app/learn/tutor/photo-upload";
import type { TutorPhotoIntent } from "../../app/learn/tutor/photo-upload";
import { tutorId } from "../fixtures/tutor-state";
import type { TransferSnapshot } from "../../lib/materials/transfer-state";

function reply(state: TransferSnapshot["state"], version: number): Response { return Response.json({ id: tutorId(101), materialId: tutorId(102), state, version }); }
function photo(bytes: number): File { return new File([new Uint8Array(bytes)], "answer.png", { type: "image/png" }); }
afterEach((): void => { vi.unstubAllGlobals(); });

describe("풀이 사진의 확정 응답과 재개", (): void => {
  it("등록 확인 응답 뒤에만 자료 ID를 반환한다", async (): Promise<void> => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(reply("reserved", 1)).mockResolvedValueOnce(reply("reserved", 1)).mockResolvedValueOnce(reply("stored", 2)).mockResolvedValueOnce(reply("registered", 3)); vi.stubGlobal("fetch", fetcher);
    const intents: TutorPhotoIntent[] = [];
    expect(await uploadTutorPhoto(photo(3), tutorId(4), null, (intent): void => { intents.push(intent); }, (): void => {})).toBe(tutorId(102));
    expect(intents.at(-1)?.uploadId).toBe(tutorId(101)); expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls.map((call) => call[1]?.method)).toEqual(["POST", "GET", "PUT", "POST"]);
  });
  it("등록 미완료 응답을 성공으로 반환하지 않고 예약을 보존한다", async (): Promise<void> => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(reply("stored", 2)).mockResolvedValueOnce(reply("stored", 2)).mockResolvedValueOnce(reply("verified", 3)); vi.stubGlobal("fetch", fetcher);
    const remember = vi.fn<(intent: TutorPhotoIntent) => void>();
    await expect(uploadTutorPhoto(photo(3), tutorId(4), null, remember, (): void => {})).rejects.toMatchObject({ name: "TutorPhotoConfirmationError" });
    expect(remember.mock.calls.at(-1)?.[0].uploadId).toBe(tutorId(101)); expect(fetcher.mock.calls.some((call) => call[1]?.method === "DELETE")).toBe(false);
  });
  it("다른 자료·이전 버전의 응답을 거부한다", async (): Promise<void> => {
    for (const mismatched of [{ id: tutorId(999), materialId: tutorId(102), version: 3, state: "registered" }, { id: tutorId(101), materialId: tutorId(999), version: 3, state: "registered" }, { id: tutorId(101), materialId: tutorId(102), version: 1, state: "registered" }]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(reply("stored", 2)).mockResolvedValueOnce(Response.json(mismatched)); vi.stubGlobal("fetch", fetcher);
      await expect(uploadTutorPhoto(photo(3), tutorId(4), null, (): void => {}, (): void => {})).rejects.toMatchObject({ name: "TutorPhotoConfirmationError" }); expect(fetcher).toHaveBeenCalledTimes(2);
    }
  });
  it("등록 응답 유실 후 같은 키·예약을 조회하고 본문을 중복 전송하지 않는다", async (): Promise<void> => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(reply("reserved", 1)).mockResolvedValueOnce(reply("reserved", 1)).mockResolvedValueOnce(reply("stored", 2)).mockRejectedValueOnce(new TypeError("시험용 응답 유실")).mockResolvedValueOnce(reply("registered", 3)).mockResolvedValueOnce(reply("registered", 3)); vi.stubGlobal("fetch", fetcher);
    const intents: TutorPhotoIntent[] = []; const remember = (intent: TutorPhotoIntent): void => { intents.push(intent); }; const file = photo(3);
    await expect(uploadTutorPhoto(file, tutorId(4), null, remember, (): void => {})).rejects.toThrow("시험용 응답 유실");
    const intent = intents.at(-1); if (!intent) throw new Error("재개 예약이 없습니다.");
    expect(await uploadTutorPhoto(file, tutorId(4), intent, remember, (): void => {})).toBe(tutorId(102));
    expect(fetcher.mock.calls.filter((call) => call[1]?.method === "PUT")).toHaveLength(1); expect(fetcher.mock.calls[0][1]?.headers).toEqual(fetcher.mock.calls[4][1]?.headers);
  });
  it("권한 거부 뒤 전송·등록을 진행하지 않는다", async (): Promise<void> => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: "forbidden" }, { status: 403 })); vi.stubGlobal("fetch", fetcher);
    await expect(uploadTutorPhoto(photo(3), tutorId(4), null, (): void => {}, (): void => {})).rejects.toMatchObject({ status: 403 }); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("8MiB 원본 보관 경계를 적용하고 초과 파일·HEIC를 전송하지 않는다", async (): Promise<void> => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(reply("registered", 3)).mockResolvedValueOnce(reply("registered", 3)); vi.stubGlobal("fetch", fetcher);
    expect(await uploadTutorPhoto(photo(8388608), tutorId(4), null, (): void => {}, (): void => {})).toBe(tutorId(102));
    await expect(uploadTutorPhoto(photo(8388609), tutorId(4), null, (): void => {}, (): void => {})).rejects.toMatchObject({ status: 413 });
    await expect(uploadTutorPhoto(new File(["image"], "answer.heic"), tutorId(4), null, (): void => {}, (): void => {})).rejects.toThrow("HEIC"); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("복구가 registered라고 말해도 실제 상태가 다르면 첨부하지 않는다", async (): Promise<void> => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(reply("unknown", 2)).mockResolvedValueOnce(reply("unknown", 2)).mockResolvedValueOnce(Response.json({ id: tutorId(101), materialId: tutorId(102), version: 3, state: "unknown", nextAction: "registered" })); vi.stubGlobal("fetch", fetcher);
    await expect(uploadTutorPhoto(photo(3), tutorId(4), null, (): void => {}, (): void => {})).rejects.toThrow("복구 응답의 상태가 일치하지 않아요");
  });
});
