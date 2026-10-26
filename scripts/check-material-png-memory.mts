import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Miniflare } from "miniflare";
import { z } from "zod";
import { pngImage } from "../tests/fixtures/png-bytes.ts";

const heapUsage = z.object({ usedSize: z.number(), totalSize: z.number(), embedderHeapUsedSize: z.number(), backingStorageSize: z.number() });
type HeapUsage = Readonly<z.infer<typeof heapUsage>>;
type InspectorTarget = Readonly<{ id: string; webSocketDebuggerUrl: string }>;
type MemoryEvidence = Readonly<{ name: string; fileBytes: number; samples: number; maximumObservedUsedHeap: number; maximumObservedHeapCapacity: number; maximumObservedBackingStorage: number; maximumObservedEmbedderHeap: number; maximumObservedSum: number }>;
function readHeap(socket: WebSocket, id: number): Promise<HeapUsage> {
  return new Promise((resolve, reject): void => {
    function finish(): void { clearTimeout(timer); socket.removeEventListener("message", message); socket.removeEventListener("error", failed); }
    function failed(event: Event): void { finish(); reject(new Error("로컬 workerd 메모리 계측 연결이 실패했습니다.", { cause: event })); }
    function message(event: MessageEvent): void {
      const envelope = z.object({ id: z.number().optional(), result: z.unknown().optional(), error: z.unknown().optional() }).safeParse(JSON.parse(String(event.data)));
      if (!envelope.success || envelope.data.id !== id) return;
      finish();
      if (envelope.data.error !== undefined) { reject(new Error("workerd 메모리 계측 요청이 거부되었습니다.", { cause: envelope.data.error })); return; }
      const parsed = heapUsage.safeParse(envelope.data.result);
      if (!parsed.success) { reject(parsed.error); return; }
      resolve(parsed.data);
    }
    const timer: ReturnType<typeof setTimeout> = setTimeout((): void => { finish(); reject(new Error("workerd 메모리 계측 응답이 5초 안에 도착하지 않았습니다.")); }, 5000);
    socket.addEventListener("message", message); socket.addEventListener("error", failed);
    socket.send(JSON.stringify({ id, method: "Runtime.getHeapUsage" }));
  });
}
async function sampleFile(runtime: Miniflare, socket: WebSocket, name: string, bytes: Uint8Array): Promise<MemoryEvidence> {
  let finished: boolean = false;
  let requestId: number = 1;
  const observations: HeapUsage[] = [await readHeap(socket, requestId++)];
  const operation: Promise<void> = (async (): Promise<void> => {
    try {
      const response = await runtime.dispatchFetch("https://local.invalid/png", { method: "POST", body: bytes, headers: { "x-fixture-bytes": String(bytes.byteLength), "x-fixture-sha256": createHash("sha256").update(bytes).digest("hex") } });
      assert.equal(response.status, 200, await response.text());
    } finally { finished = true; }
  })();
  const sampling: Promise<void> = (async (): Promise<void> => {
    while (!finished) { observations.push(await readHeap(socket, requestId++)); await delay(10); }
    observations.push(await readHeap(socket, requestId++));
  })();
  await Promise.all([operation, sampling]);
  const maximumObservedSum: number = Math.max(...observations.map((sample: HeapUsage): number => sample.usedSize + sample.embedderHeapUsedSize + sample.backingStorageSize));
  assert.ok(maximumObservedSum < 64 * 1024 * 1024, `PNG 관측 메모리가 여유 한도 64MiB를 넘었습니다: ${maximumObservedSum}`);
  return { name, fileBytes: bytes.byteLength, samples: observations.length, maximumObservedUsedHeap: Math.max(...observations.map((sample: HeapUsage): number => sample.usedSize)), maximumObservedHeapCapacity: Math.max(...observations.map((sample: HeapUsage): number => sample.totalSize)), maximumObservedBackingStorage: Math.max(...observations.map((sample: HeapUsage): number => sample.backingStorageSize)), maximumObservedEmbedderHeap: Math.max(...observations.map((sample: HeapUsage): number => sample.embedderHeapUsedSize)), maximumObservedSum };
}
const runtime: Miniflare = new Miniflare({ name: "png-memory", modules: true, scriptPath: path.resolve(".sites-runtime/material-png-check/worker.mjs"), compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"], cf: false, inspectorPort: 0 });
let socket: WebSocket | null = null;
try {
  const endpoint: URL = await runtime.getInspectorURL(); endpoint.protocol = "http:"; endpoint.pathname = "/json";
  const targets: readonly InspectorTarget[] = z.array(z.object({ id: z.string(), webSocketDebuggerUrl: z.string().url() })).parse(await (await fetch(endpoint)).json());
  const target: InspectorTarget | undefined = targets.find((entry: InspectorTarget): boolean => entry.id === "core:user:png-memory");
  if (target === undefined) throw new Error("로컬 PNG Worker의 디버거 대상이 없습니다.");
  const connection: WebSocket = new WebSocket(target.webSocketDebuggerUrl); socket = connection;
  await new Promise<void>((resolve, reject): void => { connection.addEventListener("open", (): void => resolve(), { once: true }); connection.addEventListener("error", (event: Event): void => reject(new Error("workerd 디버거 연결 실패", { cause: event })), { once: true }); });
  const results: MemoryEvidence[] = [];
  results.push(await sampleFile(runtime, connection, "16-million-pixels-128MB-decoded", pngImage({ width: 4000, height: 4000, depth: 16, color: 6, interlace: 0 }, new Uint8Array(4000 * 32001))));
  results.push(await sampleFile(runtime, connection, "maximum-row-256KiB", pngImage({ width: 32768, height: 1, depth: 16, color: 6, interlace: 0 }, new Uint8Array(262145))));
  const noisyRows: Buffer = randomBytes(1000 * 8001);
  for (let row: number = 0; row < 1000; row += 1) noisyRows[row * 8001] = 0;
  results.push(await sampleFile(runtime, connection, "8MB-incompressible-pixels", pngImage({ width: 2000, height: 1000, depth: 8, color: 6, interlace: 0 }, noisyRows)));
  const report = { checkedAt: new Date().toISOString(), status: "passed", runtime: "local-workerd-inspector", results, measurement: "Runtime.getHeapUsage samples at 10ms intervals while requests are active; sum is observed usedSize + embedderHeapUsedSize + backingStorageSize", entireNativeProcessMeasured: false, guaranteedPeak: false, actualSitesMemoryMeasured: false, caveat: "Sampling may miss peaks; native allocator/RSS and hosted Vinext runtime are not included. Host fixture generation buffers are outside the measured Worker.", hostedWrites: 0, openAiCalls: 0 };
  await writeFile(".taskmaster/reports/task-5-png-memory.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
} finally { socket?.close(); await runtime.dispose(); }
