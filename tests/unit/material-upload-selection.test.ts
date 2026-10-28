import { describe, expect, it } from "vitest";
import { prepareUploadQueue, recoveryFile, selectedFiles } from "../../app/learn/materials/upload-selection";
import { hashClientFile } from "../../lib/materials/client-file";

function form(files: readonly File[]): FormData {
  const data: FormData = new FormData();
  data.set("courseId", "00000000-0000-4000-a000-000000000001"); data.set("inputKind", "file"); data.set("role", "reference"); data.set("edition", "2026"); data.set("title", "직접 작성한 제목");
  for (const file of files) data.append("file", file);
  return data;
}

describe("여러 원본 등록 선택 계약", (): void => {
  it("PDF와 여러 사진은 별개 자료·키를 가지며 같은 과정·판본·역할을 유지한다", (): void => {
    const files: readonly File[] = [new File(["PDF"], "교재.pdf"), new File(["JPEG"], "사진1.jpg"), new File(["PNG"], "사진2.png")];
    const queue = prepareUploadQueue(form(files));
    expect(queue.map((entry): string => entry.metadata.title)).toEqual(files.map((file): string => file.name));
    expect(queue.map((entry): string => entry.metadata.mime)).toEqual(["application/pdf", "image/jpeg", "image/png"]);
    expect(new Set(queue.map((entry): string => entry.key)).size).toBe(3);
    expect(new Set(queue.map((entry): string => entry.courseId)).size).toBe(1);
    expect(queue.every((entry): boolean => entry.metadata.role === "reference" && entry.metadata.edition === "2026")).toBe(true);
  });
  it("단일 파일은 직접 작성한 제목을 사용한다", (): void => {
    expect(prepareUploadQueue(form([new File(["원본"], "원본.txt")]))[0].metadata.title).toBe("직접 작성한 제목");
  });
  it("텍스트 붙여넣기는 남아 있는 파일 선택과 섞이지 않는다", (): void => {
    const data: FormData = form([new File(["이전 파일"], "이전.txt")]); data.set("inputKind", "text"); data.set("text", "붙여넣은 한글");
    const queue = prepareUploadQueue(data);
    expect(queue).toHaveLength(1); expect(queue[0].metadata.filename).toBe("붙여넣은-텍스트.txt"); expect(queue[0].metadata.title).toBe("직접 작성한 제목");
  });
  it("빈 파일·과대 파일·사진 답안의 PDF는 일부 예약 전에 거부한다", (): void => {
    expect(() => selectedFiles(form([new File([], "빈.txt")]))).toThrow("빈 파일");
    expect(() => prepareUploadQueue(form([new File([new Uint8Array(1048577)], "큰.txt")]))).toThrow("큰.txt");
    const data: FormData = form([new File(["PNG"], "사진.png"), new File(["PDF"], "교재.pdf")]); data.set("role", "answer");
    expect(() => prepareUploadQueue(data)).toThrow("교재.pdf: 사진 답안");
  });
  it("복구 원본은 첫 번째 파일이나 이름으로 추측하지 않고 내용을 대조한다", async (): Promise<void> => {
    const other: File = new File(["다른내용"], "원본.txt"); const original: File = new File(["원래내용"], "원본.txt");
    const metadata = { ...prepareUploadQueue(form([original]))[0].metadata, sha256: await hashClientFile(original) };
    expect(await recoveryFile([other, original], metadata)).toBe(original);
    await expect(recoveryFile([other], metadata)).rejects.toThrow("처음 등록한 것과 같은 파일");
  });
});
