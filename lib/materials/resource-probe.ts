import { materialFailure, materialPolicy, requireMaterialBodyLength, validateMaterialMetadata } from "./policy";
import type { MaterialMetadata } from "./policy";
import { transferMaterialBytes } from "./stream";
import type { MaterialStreamProof } from "./stream";
import { deletePrivateObject, readPrivateObject } from "../r2-access";

export type MaterialResourceProbe = Readonly<{
  checkedAt: string;
  upload: MaterialStreamProof;
  download: MaterialStreamProof;
  contentLength: string | null;
  objectBytes: number;
  rangeBytes: number;
  storedBytesBeforeProbe: number;
  cleanup: "passed";
  contentValidated: false;
  accountQuotaVerified: false;
  wholeIsolateMemoryMeasured: false;
}>;

/** 연결된 버킷의 실제 객체 사용량만 합산하며 계정의 남은 용량으로 해석하지 않습니다. */
async function storedBytes(bucket: R2Bucket): Promise<number> {
  let cursor: string | undefined;
  let bytes: number = 0;
  for (let page: number = 0; page < 100; page += 1) {
    const result: R2Objects = await bucket.list({ limit: 1000, cursor });
    for (const object of result.objects) bytes += object.size;
    if (!Number.isSafeInteger(bytes)) throw new RangeError("저장소 사용량이 안전한 정수 범위를 초과했습니다.");
    if (!result.truncated) return bytes;
    cursor = result.cursor;
  }
  throw new RangeError("저장소 사용량 검사 범위 100,000개를 초과했습니다. 별도 용량 대사가 필요합니다.");
}

/** 고정된 경계 크기의 합성 진단만 허용하며 학습 자료를 등록하지 않습니다. */
export function resourceProbeMetadata(headers: Headers): MaterialMetadata {
  const metadata: MaterialMetadata = validateMaterialMetadata({
    title: "운영 전송 검사", edition: "", role: "reference", kind: headers.get("x-probe-kind"),
    filename: headers.get("x-probe-filename"), mime: headers.get("x-probe-mime"),
    bytes: Number(headers.get("x-probe-bytes")), sha256: headers.get("x-probe-sha256"),
  });
  const maximum: number = materialPolicy.types[metadata.kind].maximumBytes;
  if (![maximum - 1, maximum].includes(metadata.bytes)) throw materialFailure("material_metadata_invalid", "probe-boundary-bytes", 400);
  requireMaterialBodyLength(headers.get("content-length"), metadata.bytes);
  return metadata;
}

/** 완료한 진단 객체의 해시와 부분 읽기를 확인합니다. 실제 파일 형식 검증은 별도 절차입니다. */
async function readProbe(bucket: R2Bucket, key: string, metadata: MaterialMetadata, signal: AbortSignal): Promise<Readonly<{ download: MaterialStreamProof; rangeBytes: number }>> {
  const saved: R2ObjectBody | null = await readPrivateObject(bucket, key);
  if (saved === null || saved.size !== metadata.bytes) throw new Error("진단 객체 저장 크기가 요청과 다릅니다.");
  const download: MaterialStreamProof = await transferMaterialBytes(saved.body, new WritableStream<Uint8Array>({ write(): void {} }), metadata, signal);
  const part: R2ObjectBody | R2Object | null = await bucket.get(key, { range: { offset: metadata.bytes - 32, length: 32 }, onlyIf: { etagMatches: saved.etag } });
  if (part === null || !("body" in part) || part.range === undefined || !("length" in part.range) || part.range.length !== 32) throw new Error("동일 버전의 R2 부분 읽기 결과가 올바르지 않습니다.");
  const range: ArrayBuffer = await part.arrayBuffer();
  if (range.byteLength !== 32 || new Uint8Array(range).some((byte: number): boolean => byte !== 0)) throw new Error("진단 객체의 끝 32바이트가 원본과 다릅니다.");
  return { download, rangeBytes: range.byteLength };
}

/** 임시 multipart를 검증 후 완료하고 고유 진단 객체만 정리합니다. 결과 불명 쓰기는 자동 재전송하지 않습니다. */
export async function probeMaterialResources(request: Request, bucket: R2Bucket): Promise<MaterialResourceProbe> {
  const metadata: MaterialMetadata = resourceProbeMetadata(request.headers);
  if (request.body === null) throw materialFailure("material_body_length_invalid", "request-body", 400);
  const storedBytesBeforeProbe: number = await storedBytes(bucket);
  const key: string = `diagnostics/material-stream/${crypto.randomUUID()}`;
  const upload: R2MultipartUpload = await bucket.createMultipartUpload(key, { httpMetadata: { contentType: "application/octet-stream" } });
  let completed: boolean = false;
  try {
    const bridge: FixedLengthStream = new FixedLengthStream(metadata.bytes);
    const transferAbort: AbortController = new AbortController();
    const signal: AbortSignal = AbortSignal.any([request.signal, transferAbort.signal]);
    const outcomes = await Promise.allSettled([
      transferMaterialBytes(request.body, bridge.writable, metadata, signal),
      upload.uploadPart(1, bridge.readable).catch((error: unknown): never => { transferAbort.abort(error); throw error; }),
    ]);
    const [copy, part] = outcomes;
    if (copy.status === "rejected") throw copy.reason;
    if (part.status === "rejected") throw part.reason;
    const object: R2Object = await upload.complete([part.value]);
    completed = true;
    const readback = await readProbe(bucket, key, metadata, request.signal);
    await deletePrivateObject(bucket, key);
    return { checkedAt: new Date().toISOString(), upload: copy.value, download: readback.download, contentLength: request.headers.get("content-length"), objectBytes: object.size, rangeBytes: readback.rangeBytes, storedBytesBeforeProbe, cleanup: "passed", contentValidated: false, accountQuotaVerified: false, wholeIsolateMemoryMeasured: false };
  } catch (error: unknown) {
    console.warn({ event: "material_resource_probe_failed", key, uploadId: upload.uploadId, completed, replayAllowed: false, errorType: error instanceof Error ? error.name : "unknown" });
    try {
      if (completed) await deletePrivateObject(bucket, key);
      else await upload.abort();
    } catch (cleanupError: unknown) {
      throw new AggregateError([error, cleanupError], "운영 전송 검사와 임시 객체 정리가 함께 실패했습니다. 진단 키와 multipart 상태를 확인하세요.");
    }
    throw error;
  }
}
