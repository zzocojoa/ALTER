import { describe, expect, it } from "vitest";
import { preparePageVisionRequest, visionContext } from "../../lib/extraction/vision";
import { validatePageVision, visionBinding } from "../../lib/extraction/vision-contract";
import type { PageVision } from "../../lib/extraction/vision-contract";
import { validateLearningOutput, learningFormat } from "../../lib/ai/learning-contract";
import { prepareAiRequest } from "../../lib/ai/request-bound";
import { recordId } from "../../lib/domain/contracts";
import type { ExtractionJob } from "../../db/repositories/extraction-jobs";
import type { PreparedPageImage } from "../../lib/extraction/image";

const id = recordId.parse("00000000-0000-4000-8000-000000000001");
const job: ExtractionJob = { jobId: id, revision: 2, uploadId: crypto.randomUUID(), selection: { materialId: id, originalHash: "a".repeat(64), originalVersion: "v1", pages: [{ filePage: 3, purpose: "study" }] } };
const image: PreparedPageImage = { dataUrl: "data:image/png;base64,AQ==", mime: "image/png", bytes: 1, sha256: "b".repeat(64), width: 100, height: 200, sourceWidth: 100, sourceHeight: 200, rotation: 0, sourceToImage: [1, 0, 0, 1, 0, 0], coordinateSpace: "pdf-viewport" };
describe("선택 페이지 비전 계약", (): void => {
  it("한 이미지와 최소 결합 정보만 공통 모델에 전달한다", async (): Promise<void> => {
    const value = await preparePageVisionRequest({ job, filePage: 3 }, image, id);
    const prepared = await prepareAiRequest(value.request);
    expect(prepared.imageCount).toBe(1); expect(prepared.body.model).toBe("gpt-6-luna"); expect(prepared.body.tools).toEqual([]); expect(prepared.body.max_output_tokens).toBe(4096);
    expect(prepared.body.text?.format).toMatchObject({ name: "alter_page_vision" }); expect(value.request.instructions).toContain("비신뢰"); expect(JSON.stringify(value.request)).not.toContain("objectKey");
    expect(JSON.stringify(learningFormat)).not.toContain("page-vision");
  });
  it("긴 손글씨의 원본 해상도를 요청에 보존하고 기존 응답 결합값도 읽는다", async (): Promise<void> => {
    const tall: PreparedPageImage = { ...image, width: 534, height: 3074, sourceWidth: 534, sourceHeight: 3074 };
    const value = await preparePageVisionRequest({ job, filePage: 3 }, tall, id);
    expect(value.binding).toMatchObject({ width: 534, height: 3074 });
    expect(visionBinding.safeParse({ ...value.binding, width: 277, height: 1599 }).success).toBe(true);
    expect(visionBinding.safeParse({ ...value.binding, height: 4097 }).success).toBe(false);
    const prepared = await prepareAiRequest(value.request);
    expect(prepared.imageCount).toBe(1); expect(prepared.body.max_output_tokens).toBe(4096);
  });
  it("원본·선택·파일 페이지·입력 이미지가 하나라도 다르면 거부한다", async (): Promise<void> => {
    const { binding } = await preparePageVisionRequest({ job, filePage: 3 }, image, id);
    const response: PageVision = { kind: "page-vision", binding, page: { filePage: 3, method: "vision", status: "complete", width: 100, height: 200, rotation: 0, segments: [{ id: "s0", kind: "formula", text: "x^2+y^2", bounds: { x: 0.1, y: 0.1, width: 0.4, height: 0.1 }, transform: null, uncertain: true, reason: "첨자 대조 필요" }], error: null, requiresConfirmation: true } };
    expect(validateLearningOutput({ result: response }, "page-vision", visionContext(binding)).result.kind).toBe("page-vision");
    for (const change of [{ materialId: recordId.parse(crypto.randomUUID()) }, { originalVersion: "v2" }, { originalHash: "c".repeat(64) }, { filePage: 4 }, { selectionRevision: 3 }, { imageSha256: "d".repeat(64) }, { width: 101 }]) expect(() => validatePageVision({ ...response, binding: { ...binding, ...change } }, binding)).toThrow();
    expect(() => validatePageVision({ ...response, page: { ...response.page, filePage: 4 } }, binding)).toThrow();
    expect(() => validatePageVision({ ...response, page: { ...response.page, segments: [{ ...response.page.segments[0], bounds: { x: 0.9, y: 0.1, width: 0.5, height: 0.1 } }] } }, binding)).toThrow();
    expect(() => validateLearningOutput({ result: response }, "page-vision", { ...visionContext(binding), extractionPage: undefined })).toThrow();
  });
});
