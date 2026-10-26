import { z } from "zod";

export const materialKind = z.enum(["pdf", "image", "text"]);
export const materialRole = z.enum(["textbook", "reference", "answer"]);
export type MaterialKind = z.infer<typeof materialKind>;
export type MaterialRole = z.infer<typeof materialRole>;
export type MaterialLimits = Readonly<{ maximumBytes: number; maximumPages: number; maximumPixels: number }>;

/** 승인된 제품 상한이며 실제 배포 증거를 통과하기 전에는 등록을 허용하지 않습니다. */
export const materialPolicy = Object.freeze({
  version: "materials-v2",
  storageVerification: "application-256mib-r2-verified-v1",
  streamChunkBytes: 65_536,
  validationTimeoutMs: 150_000,
  recoveryTimeoutMs: 180_000,
  maximumStorageBytes: 268_435_456,
  maximumConcurrentTransfers: 1,
  types: {
    pdf: { maximumBytes: 20_971_520, maximumPages: 500, maximumPixels: 0 },
    image: { maximumBytes: 8_388_608, maximumPages: 1, maximumPixels: 16_000_000 },
    text: { maximumBytes: 1_048_576, maximumPages: 1, maximumPixels: 0 },
  } satisfies Readonly<Record<MaterialKind, MaterialLimits>>,
} as const);

export const materialMetadata = z.object({
  title: z.string().trim().min(1).max(300),
  edition: z.string().trim().max(100),
  role: materialRole,
  kind: materialKind,
  filename: z.string().min(1).max(200).refine((value: string): boolean => !/[\u0000-\u001f\u007f/\\]/.test(value), "경로와 제어 문자가 없는 파일명이 필요합니다."),
  mime: z.enum(["application/pdf", "image/jpeg", "image/png", "text/plain"]),
  bytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type MaterialMetadata = Readonly<z.infer<typeof materialMetadata>>;
export type MaterialFailureCode = "material_metadata_invalid" | "material_type_mismatch" | "material_size_exceeded" | "material_storage_unavailable" | "material_runtime_unverified" | "material_body_length_invalid" | "material_checksum_mismatch" | "material_stream_unsupported" | "material_content_invalid" | "material_request_invalid" | "material_not_found" | "material_version_conflict" | "material_access_required";
export type MaterialFailure = Error & Readonly<{ code: MaterialFailureCode; field: string; status: number }>;

export function materialFailure(code: MaterialFailureCode, field: string, status: number): MaterialFailure {
  return Object.assign(new Error(`자료 요청을 처리할 수 없습니다: ${code}. ${field} 항목을 확인하세요.`), { name: "MaterialFailure", code, field, status });
}

/** 사용자 식별자와 객체 키는 입력 계약에 포함하지 않습니다. */
export function validateMaterialMetadata(value: unknown): MaterialMetadata {
  const parsed = materialMetadata.safeParse(value);
  if (!parsed.success) throw materialFailure("material_metadata_invalid", parsed.error.issues[0].path.join("."), 400);
  const input: MaterialMetadata = parsed.data;
  const extension: string = input.filename.slice(input.filename.lastIndexOf(".")).toLowerCase();
  const allowed: boolean = input.kind === "pdf" ? input.mime === "application/pdf" && extension === ".pdf" : input.kind === "text" ? input.mime === "text/plain" && extension === ".txt" : input.mime === "image/jpeg" && [".jpg", ".jpeg"].includes(extension) || input.mime === "image/png" && extension === ".png";
  if (!allowed) throw materialFailure("material_type_mismatch", "filename/mime/kind", 415);
  if (input.bytes > materialPolicy.types[input.kind].maximumBytes) throw materialFailure("material_size_exceeded", "bytes", 413);
  return input;
}

/** 선언 길이가 없으면 스트림 실측을 사용하지만 조작된 길이를 묵인하지 않습니다. */
export function requireMaterialBodyLength(header: string | null, expectedBytes: number): void {
  if (header === null) return;
  if (!/^[1-9]\d*$/.test(header) || !Number.isSafeInteger(Number(header)) || Number(header) !== expectedBytes) throw materialFailure("material_body_length_invalid", "Content-Length", 400);
}

/** 객체 사용량과 미확정·전송 중 예약을 중복 없이 합산하며 확인되지 않은 예약을 해제하지 않습니다. */
export function requireMaterialStorage(occupiedBytes: number, reservedBytes: number, requestedBytes: number): void {
  for (const value of [occupiedBytes, reservedBytes, requestedBytes]) if (!Number.isSafeInteger(value) || value < 0) throw materialFailure("material_storage_unavailable", "storage-evidence", 503);
  if (requestedBytes < 1 || occupiedBytes > materialPolicy.maximumStorageBytes - reservedBytes - requestedBytes) throw materialFailure("material_storage_unavailable", "application-capacity", 507);
}

export const materialRuntimeEvidence = z.object({
  policyVersion: z.literal(materialPolicy.version),
  deploymentId: z.string().min(1),
  checkedAt: z.number().int().nonnegative(),
  validUntil: z.number().int().positive(),
  acceptedBodyBytes: z.number().int().min(materialPolicy.types.pdf.maximumBytes),
  maximumBufferedBytes: z.number().int().positive().max(materialPolicy.streamChunkBytes),
  workerMemoryLimitBytes: z.literal(134_217_728),
  contentValidation: z.object({ pdf: z.literal(true), image: z.literal(true), text: z.literal(true) }).strict(),
  privateRangeReadVerified: z.literal(true),
  storageVerification: z.literal(materialPolicy.storageVerification),
  r2WriteReadVerified: z.literal(true),
  accountRemainingQuota: z.literal("unavailable"),
  additionalPaidResources: z.literal(false),
}).strict().refine((value): boolean => value.validUntil > value.checkedAt, "검증 유효 기간이 올바르지 않습니다.");
export type MaterialRuntimeEvidence = Readonly<z.infer<typeof materialRuntimeEvidence>>;

/** 로컬 성공으로 운영 검증을 대체하거나 미확인 제한에 기본값을 넣지 않습니다. */
export function requireMaterialRuntime(value: unknown, now: number): MaterialRuntimeEvidence {
  const checked = materialRuntimeEvidence.safeParse(value);
  if (!checked.success || !Number.isSafeInteger(now) || now < checked.data.checkedAt || now >= checked.data.validUntil) throw materialFailure("material_runtime_unverified", "runtime-evidence", 503);
  return checked.data;
}
