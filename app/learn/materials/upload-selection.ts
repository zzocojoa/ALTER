import { z } from "zod";
import { materialRole, validateMaterialMetadata, type MaterialMetadata } from "@/lib/materials/policy";
import { hashClientFile } from "@/lib/materials/client-file";

export type UploadQueueEntry = Readonly<{ key: string; file: File; courseId: string; metadata: MaterialMetadata; status: "waiting" | "registering" | "registered" | "attention"; transferId: string | null; materialId: string | null; error: string | null }>;

export function selectedFiles(data: FormData): readonly File[] {
  if (data.get("inputKind") === "text") {
    const value: string = String(data.get("text") ?? "");
    if (value.trim().length === 0) throw new Error("등록할 텍스트를 붙여 넣어 주세요.");
    return [new File([value], "붙여넣은-텍스트.txt", { type: "text/plain" })];
  }
  const files: readonly FormDataEntryValue[] = data.getAll("file");
  if (files.length === 0 || files.some((file): boolean => !(file instanceof File) || file.size < 1)) throw new Error("빈 파일을 제외하고 등록할 파일을 선택해 주세요.");
  return files as readonly File[];
}

function declaredMetadata(data: FormData, file: File, title: string): MaterialMetadata {
  const suffix: string = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  const types = { ".pdf": { kind: "pdf", mime: "application/pdf" }, ".png": { kind: "image", mime: "image/png" }, ".jpg": { kind: "image", mime: "image/jpeg" }, ".jpeg": { kind: "image", mime: "image/jpeg" }, ".txt": { kind: "text", mime: "text/plain" } } as const;
  if (!(suffix in types)) throw new Error(file.name + ": PDF·JPG·PNG·UTF-8 TXT 파일을 선택해 주세요. HEIC는 지원하지 않아요.");
  const selected = types[suffix as keyof typeof types];
  const role = materialRole.parse(data.get("role"));
  if (role === "answer" && selected.kind !== "image") throw new Error(file.name + ": 사진 답안에는 JPG 또는 PNG 파일을 선택해 주세요.");
  try { return validateMaterialMetadata({ title, edition: data.get("edition"), role, ...selected, filename: file.name, bytes: file.size, sha256: "0".repeat(64) }); }
  catch (cause: unknown) { throw new Error(file.name + ": " + (cause instanceof Error ? cause.message : "파일 정보를 확인해 주세요."), { cause }); }
}

/** 모든 파일의 형식·크기를 먼저 검사해 잘못된 선택으로 일부만 예약하는 일을 막습니다. */
export function prepareUploadQueue(data: FormData): readonly UploadQueueEntry[] {
  const files: readonly File[] = selectedFiles(data);
  const courseId: string = z.string().uuid().parse(data.get("courseId"));
  return files.map((file): UploadQueueEntry => ({ key: crypto.randomUUID(), file, courseId, metadata: declaredMetadata(data, file, files.length > 1 ? file.name.normalize("NFC") : String(data.get("title") ?? "")), status: "waiting", transferId: null, materialId: null, error: null }));
}

/** 복구는 선택 순서가 아니라 크기와 내용 해시가 같은 원본을 사용합니다. */
export async function recoveryFile(files: readonly File[], metadata: MaterialMetadata): Promise<File> {
  for (const file of files) if (file.size === metadata.bytes && await hashClientFile(file) === metadata.sha256) return file;
  throw new Error("처음 등록한 것과 같은 파일이나 텍스트를 선택해 주세요.");
}
