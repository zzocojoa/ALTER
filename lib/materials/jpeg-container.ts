import { materialFailure, materialPolicy } from "./policy";
import { parseJpegMpf } from "./jpeg-mpf";
import type { JpegMpf } from "./jpeg-mpf";

type MarkerState = "start" | "soi" | "marker" | "code" | "length-high" | "length-low" | "payload" | "entropy" | "end";
export type JpegFrame = Readonly<{ body: ReadableStream<Uint8Array>; facts: () => Readonly<{ start: number; end: number; mpf: JpegMpf | null }> }>;
export type JpegContainer = Readonly<{ frame: () => JpegFrame; requireEnd: () => Promise<void>; close: () => Promise<void> }>;
function invalid(field: string): Error { return materialFailure("material_content_invalid", `jpeg:${field}`, 422); }

/** 원본은 64KiB 창으로 읽고 APP2 하나만 보관하며 EOI 경계별로 기존 엄격 디코더에 전달합니다. */
export function readJpegContainer(source: ReadableStream<Uint8Array>, signal: AbortSignal): JpegContainer {
  const reader: ReadableStreamDefaultReader<Uint8Array> = source.getReader();
  let pending: Uint8Array = new Uint8Array(0);
  let offset: number = 0;
  let position: number = 0;
  async function available(): Promise<boolean> {
    signal.throwIfAborted();
    while (offset === pending.length) {
      const part: ReadableStreamReadResult<Uint8Array> = await reader.read();
      if (part.done) return false;
      if (part.value.length > materialPolicy.streamChunkBytes) throw invalid("input-chunk-limit");
      pending = part.value; offset = 0;
    }
    return true;
  }
  function frame(): JpegFrame {
    const start: number = position;
    let state: MarkerState = "start";
    let marker: number = 0;
    let length: number = 0;
    let remaining: number = 0;
    let inEntropy: boolean = false;
    let app2: Uint8Array | null = null;
    let appOffset: number = 0;
    let mpf: JpegMpf | null = null;
    function accept(byte: number): void {
      switch (state) {
        case "start": if (byte !== 255) throw invalid("soi"); state = "soi"; return;
        case "soi": if (byte !== 216) throw invalid("soi"); state = "marker"; return;
        case "marker": if (byte !== 255) throw invalid("marker"); state = "code"; return;
        case "entropy": if (byte === 255) state = "code"; return;
        case "code":
          if (byte === 255) return;
          if (inEntropy && (byte === 0 || (byte >= 208 && byte <= 215))) { state = "entropy"; return; }
          if (byte === 217) { state = "end"; return; }
          if (byte === 0 || byte === 216 || byte === 1 || (byte >= 208 && byte <= 215)) throw invalid("marker");
          marker = byte; inEntropy = false; state = "length-high"; return;
        case "length-high": length = byte * 256; state = "length-low"; return;
        case "length-low":
          length += byte; remaining = length - 2;
          if (remaining < 0) throw invalid("segment-length");
          app2 = marker === 226 ? new Uint8Array(remaining) : null; appOffset = position + 1;
          state = remaining === 0 ? (marker === 218 ? "entropy" : "marker") : "payload";
          inEntropy = state === "entropy"; return;
        case "payload":
          if (app2 !== null) app2[length - 2 - remaining] = byte;
          remaining -= 1;
          if (remaining === 0) {
            if (app2 !== null) {
              const parsed: JpegMpf | null = parseJpegMpf(app2, appOffset + 4);
              if (parsed !== null) { if (mpf !== null) throw invalid("mpf-duplicate-index"); mpf = parsed; }
              app2 = null;
            }
            inEntropy = marker === 218; state = inEntropy ? "entropy" : "marker";
          }
          return;
        case "end": throw invalid("frame-ended");
      }
    }
    const body: ReadableStream<Uint8Array> = new ReadableStream<Uint8Array>({
      async pull(controller): Promise<void> {
        if (!await available()) { controller.close(); return; }
        const begin: number = offset;
        while (offset < pending.length && state !== "end") { accept(pending[offset]); offset += 1; position += 1; }
        controller.enqueue(pending.subarray(begin, offset));
        if (state === "end") controller.close();
      },
    }, { highWaterMark: 0 });
    return { body, facts: () => { if (state !== "end") throw invalid("unexpected-eof"); return { start, end: position, mpf }; } };
  }
  return { frame, requireEnd: async (): Promise<void> => { if (await available()) throw invalid("trailing-bytes"); }, close: async (): Promise<void> => { try { await reader.cancel(); } finally { reader.releaseLock(); } } };
}
