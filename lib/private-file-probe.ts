type ProbeMethod = "GET" | "PUT" | "DELETE";
type CleanupReceipt = "already-absent" | "removed-and-verified";
type ProbeReceipt = Readonly<{ create: 201; read: 200; remove: 200; absent: 404 }>;

async function probeRequest(path: string, method: ProbeMethod, body: string | null, signal: AbortSignal): Promise<Response> {
  return fetch(path, { method, body, signal, credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
}

function requireStatus(response: Response, expected: number, method: ProbeMethod, path: string): void {
  if (response.status !== expected) {
    throw new Error(JSON.stringify({ error: "private_file_probe_http_failure", method, path, expected, status: response.status }));
  }
}

async function requireProbeContent(response: Response, payload: string, path: string): Promise<void> {
  requireStatus(response, 200, "GET", path);
  if (await response.text() !== payload) throw new Error(JSON.stringify({ error: "private_file_probe_content_mismatch", path }));
}

/** 생성 결과가 불명확해도 같은 임시 파일의 내용을 확인한 뒤에만 정리합니다. */
async function cleanProbeFile(path: string, payload: string): Promise<CleanupReceipt> {
  const signal: AbortSignal = AbortSignal.timeout(15_000);
  const current: Response = await probeRequest(path, "GET", null, signal);
  if (current.status === 404) return "already-absent";
  await requireProbeContent(current, payload, path);
  const removed: Response = await probeRequest(path, "DELETE", null, signal);
  requireStatus(removed, 200, "DELETE", path);
  const receipt: unknown = await removed.json();
  if (typeof receipt !== "object" || receipt === null || !("deleted" in receipt) || receipt.deleted !== true) {
    throw new Error(JSON.stringify({ error: "private_file_probe_invalid_delete_receipt", path }));
  }
  const absent: Response = await probeRequest(path, "GET", null, signal);
  requireStatus(absent, 404, "GET", path);
  return "removed-and-verified";
}

/** 실제 브라우저 세션으로 파일 API를 왕복 검사하며 개인 파일은 입력받지 않습니다. */
export async function verifyPrivateFileAccess(signal: AbortSignal): Promise<ProbeReceipt> {
  const id: string = crypto.randomUUID();
  const path: string = `/api/files/${id}`;
  const payload: string = `ALTER disposable access check ${id}`;
  let operationFailure: unknown = undefined;
  let failed: boolean = false;
  try {
    const created: Response = await probeRequest(path, "PUT", payload, signal);
    requireStatus(created, 201, "PUT", path);
    const receipt: unknown = await created.json();
    if (typeof receipt !== "object" || receipt === null || !("id" in receipt) || receipt.id !== id) {
      throw new Error(JSON.stringify({ error: "private_file_probe_invalid_create_receipt", path }));
    }
    await requireProbeContent(await probeRequest(path, "GET", null, signal), payload, path);
  } catch (error: unknown) {
    operationFailure = error;
    failed = true;
  }
  try {
    const cleanup: CleanupReceipt = await cleanProbeFile(path, payload);
    if (!failed && cleanup !== "removed-and-verified") {
      throw new Error(JSON.stringify({ error: "private_file_probe_missing_before_delete", path }));
    }
  } catch (cleanupFailure: unknown) {
    if (failed) throw new AggregateError([operationFailure, cleanupFailure], "임시 파일 검사와 정리에 실패했습니다.");
    throw cleanupFailure;
  }
  if (failed) throw operationFailure;
  return { create: 201, read: 200, remove: 200, absent: 404 };
}
