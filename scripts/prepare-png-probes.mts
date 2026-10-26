import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { pngImage, pngFile, pngChunk, pngHeader } from "../tests/fixtures/png-bytes.ts";
import type { PngFixtureHeader } from "../tests/fixtures/png-bytes.ts";

type Probe = Readonly<{ id: string; title: string; bytes: Buffer; status: number; pixels: number; decodedBytes: number; field: string }>;
const gray: PngFixtureHeader = { width: 1, height: 1, depth: 8, color: 0, interlace: 0 };
const large: Buffer = pngImage({ width: 4000, height: 4000, depth: 16, color: 6, interlace: 0 }, new Uint8Array(4000 * 32001));
const badCrc: Buffer = pngImage(gray, new Uint8Array([0,42])); badCrc[29] ^= 1;
const probes: readonly Probe[] = [
  { id: "maximum-pixels", title: "최대 픽셀 이미지", bytes: large, status: 200, pixels: 16000000, decodedBytes: 128000000, field: "" },
  { id: "maximum-row", title: "최대 행 크기", bytes: pngImage({ width: 32768, height: 1, depth: 16, color: 6, interlace: 0 }, new Uint8Array(262145)), status: 200, pixels: 32768, decodedBytes: 262144, field: "" },
  { id: "maximum-rows", title: "최대 행 개수", bytes: pngImage({ width: 1, height: 65536, depth: 8, color: 0, interlace: 0 }, new Uint8Array(131072)), status: 200, pixels: 65536, decodedBytes: 65536, field: "" },
  { id: "adam7", title: "인터레이스 이미지", bytes: await readFile("tests/fixtures/pngsuite/basi6a16.png"), status: 200, pixels: 1024, decodedBytes: 8192, field: "" },
  { id: "invalid-crc", title: "손상된 체크섬 거부", bytes: badCrc, status: 422, pixels: 0, decodedBytes: 0, field: "png:crc" },
  { id: "trailing-compressed", title: "남은 압축 데이터 거부", bytes: pngFile([pngHeader(gray), pngChunk("IDAT", Buffer.concat([deflateSync(new Uint8Array([0,42])), Buffer.from([1,2,3])])), pngChunk("IEND", new Uint8Array())]), status: 422, pixels: 0, decodedBytes: 0, field: "png:trailing-compressed-bytes" },
  { id: "excess-pixels", title: "픽셀 상한 초과 거부", bytes: pngImage({ width: 4001, height: 4000, depth: 16, color: 6, interlace: 0 }, new Uint8Array([0])), status: 422, pixels: 0, decodedBytes: 0, field: "png:pixel-limit" },
];
await mkdir("public/diagnostics/png", { recursive: true });
for (const probe of probes) await writeFile(`public/diagnostics/png/${probe.id}.png`, probe.bytes);
await writeFile("public/diagnostics/png/LICENSE.txt", await readFile("tests/fixtures/pngsuite/LICENSE.txt"));
await writeFile("lib/materials/png-probes.json", JSON.stringify(probes.map((probe: Probe) => ({ id: probe.id, title: probe.title, url: `/diagnostics/png/${probe.id}.png`, bytes: probe.bytes.byteLength, sha256: createHash("sha256").update(probe.bytes).digest("hex"), status: probe.status, pixels: probe.pixels, decodedBytes: probe.decodedBytes, field: probe.field })), null, 2) + "\n");
console.log(JSON.stringify({ fixtures: probes.length, bytes: probes.reduce((total: number, probe: Probe): number => total + probe.bytes.byteLength, 0) }));
