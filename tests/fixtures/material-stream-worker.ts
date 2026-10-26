import { materialFailure, requireMaterialBodyLength, validateMaterialMetadata } from "../../lib/materials/policy";
import { transferMaterialBytes } from "../../lib/materials/stream";
import type { MaterialMetadata, MaterialFailure } from "../../lib/materials/policy";
import type { MaterialStreamProof } from "../../lib/materials/stream";

export type MaterialStreamWorkerReport = Readonly<{ upload: MaterialStreamProof; download: MaterialStreamProof; objectBytes: number; contentLength: string | null; completedObjects: number; cleaned: boolean }>;
export type MaterialStreamWorkerFailure = Readonly<{ code: string; field: string; completedObjects: number; abortedMultipart: boolean }>;
type ProbeEnvironment = Readonly<{ BUCKET: R2Bucket }>;

/** 로컬 전용 임시 버킷만 사용하는 자원 검사이며 운영 라우트에 등록하지 않습니다. */
async function runTransfer(request: Request, env: ProbeEnvironment): Promise<Response> {
  const metadata: MaterialMetadata = validateMaterialMetadata({ title: "검사 원본", edition: "", role: "reference", kind: request.headers.get("x-fixture-kind"), filename: request.headers.get("x-fixture-name"), mime: request.headers.get("x-fixture-mime"), bytes: Number(request.headers.get("x-fixture-bytes")), sha256: request.headers.get("x-fixture-sha256") });
  requireMaterialBodyLength(request.headers.get("content-length"), metadata.bytes);
  if (!request.body) throw materialFailure("material_body_length_invalid", "request-body", 400);
  const key: string = `probe/${crypto.randomUUID()}`;
  const multipart: R2MultipartUpload = await env.BUCKET.createMultipartUpload(key);
  let completed: boolean = false;
  try {
    const bridge: FixedLengthStream = new FixedLengthStream(metadata.bytes);
    const outcomes = await Promise.allSettled([
      transferMaterialBytes(request.body, bridge.writable, metadata, request.signal),
      multipart.uploadPart(1, bridge.readable),
    ]);
    const [copy, part] = outcomes;
    if (copy.status === "rejected") throw copy.reason;
    if (part.status === "rejected") throw part.reason;
    const object: R2Object = await multipart.complete([part.value]);
    completed = true;
    const saved: R2ObjectBody | null = await env.BUCKET.get(key);
    if (saved === null) throw new Error("완료한 검사 객체를 읽을 수 없습니다.");
    const download: MaterialStreamProof = await transferMaterialBytes(saved.body, new WritableStream<Uint8Array>({ write(): void {} }), metadata, request.signal);
    const completedObjects: number = (await env.BUCKET.list()).objects.length;
    await env.BUCKET.delete(key);
    const cleaned: boolean = await env.BUCKET.head(key) === null;
    const report: MaterialStreamWorkerReport = { upload: copy.value, download, objectBytes: object.size, contentLength: request.headers.get("content-length"), completedObjects, cleaned };
    return Response.json(report);
  } catch (error: unknown) {
    if (completed) throw error;
    await multipart.abort();
    if (!(error instanceof Error) || error.name !== "MaterialFailure") throw error;
    const failure: MaterialFailure = error as MaterialFailure;
    const report: MaterialStreamWorkerFailure = { code: failure.code, field: failure.field, completedObjects: (await env.BUCKET.list()).objects.length, abortedMultipart: true };
    return Response.json(report, { status: failure.status });
  }
}

const worker = { fetch: runTransfer };
export default worker;
