import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type FixtureSpec = Readonly<{ name: string; width: number; height: number; channels: 1 | 3; options: readonly string[]; expectedStatus: number }>;
type Fixture = FixtureSpec & Readonly<{ bytes: number; sha256: string; scanlineSha256: string | null }>;
const target: string = "tests/fixtures/jpeg";
await mkdir(target, { recursive: true });
const fixtures: readonly FixtureSpec[] = [
  { name: "gray", width: 17, height: 19, channels: 1, options: [], expectedStatus: 200 },
  { name: "rgb-444", width: 31, height: 29, channels: 3, options: ["-sample", "1x1"], expectedStatus: 200 },
  { name: "rgb-420", width: 31, height: 29, channels: 3, options: [], expectedStatus: 200 },
  { name: "progressive-gray", width: 17, height: 19, channels: 1, options: ["-progressive"], expectedStatus: 200 },
  { name: "progressive-420", width: 31, height: 29, channels: 3, options: ["-progressive"], expectedStatus: 200 },
  { name: "progressive-444", width: 31, height: 29, channels: 3, options: ["-progressive", "-sample", "1x1"], expectedStatus: 200 },
  { name: "arithmetic", width: 31, height: 29, channels: 3, options: ["-arithmetic"], expectedStatus: 422 },
  { name: "arithmetic-progressive", width: 31, height: 29, channels: 3, options: ["-arithmetic", "-progressive"], expectedStatus: 422 },
  { name: "restart", width: 61, height: 59, channels: 3, options: ["-restart", "1B"], expectedStatus: 200 },
  { name: "maximum-pixels-baseline", width: 4000, height: 4000, channels: 3, options: [], expectedStatus: 200 },
  { name: "maximum-pixels-progressive", width: 4000, height: 4000, channels: 3, options: ["-progressive"], expectedStatus: 200 },
  { name: "coefficient-limit", width: 4000, height: 4000, channels: 3, options: ["-progressive", "-sample", "1x1"], expectedStatus: 422 },
  { name: "pixel-limit", width: 4001, height: 4000, channels: 3, options: [], expectedStatus: 422 },
];
function version(command: string): string {
  const result = spawnSync(command, ["-version"], { encoding: "utf8" });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(JSON.stringify({ command, status: result.status, stderr: result.stderr }));
  return (result.stdout + result.stderr).trim();
}
const oracleVersion: string = version("djpeg");
const encoderVersion: string = version("cjpeg");
if (!encoderVersion.includes("3.1.3") || !oracleVersion.includes("3.1.3")) throw new Error("기준 픽셀 생성에는 기록된 독립 네이티브 libjpeg-turbo 3.1.3 도구가 필요합니다.");
const results: Fixture[] = [];
for (const spec of fixtures) {
  const pixels: Buffer = Buffer.alloc(spec.width * spec.height * spec.channels);
  for (let index: number = 0; index < pixels.byteLength; index += 1) pixels[index] = spec.width > 100 ? 80 : (index * 17 + Math.floor(index / 31) * 13) % 256;
  const input: Buffer = Buffer.concat([Buffer.from(`${spec.channels === 1 ? "P5" : "P6"}\n${spec.width} ${spec.height}\n255\n`), pixels]);
  const jpeg: Buffer = execFileSync("cjpeg", ["-quality", "85", ...spec.options], { input, maxBuffer: 100000000 });
  const raw: Buffer = execFileSync("djpeg", ["-nosmooth", "-dct", "int", "-pnm"], { input: jpeg, maxBuffer: 100000000 });
  const header: string = `${spec.channels === 1 ? "P5" : "P6"}\n${spec.width} ${spec.height}\n255\n`;
  if (!raw.subarray(0, header.length).equals(Buffer.from(header))) throw new Error(JSON.stringify({ event: "jpeg_oracle_header", name: spec.name }));
  await writeFile(path.join(target, `${spec.name}.jpg`), jpeg);
  results.push({ ...spec, bytes: jpeg.byteLength, sha256: createHash("sha256").update(jpeg).digest("hex"), scanlineSha256: spec.expectedStatus === 200 ? createHash("sha256").update(raw.subarray(header.length)).digest("hex") : null });
}
const official: string = ".sites-runtime/jpeg-build/libjpeg-turbo-3.2.0/testimages";
for (const name of ["testorig", "testimgari", "testimgint"]) {
  const jpeg: Buffer = await readFile(path.join(official, `${name}.jpg`));
  const raw: Buffer = execFileSync("djpeg", ["-nosmooth", "-dct", "int", "-pnm"], { input: jpeg });
  const header: RegExpMatchArray | null = raw.toString("latin1", 0, 100).match(/^P6\n(\d+) (\d+)\n255\n/);
  if (header === null) throw new Error("공식 JPEG 기준 이미지의 PPM 헤더를 확인할 수 없습니다.");
  await copyFile(path.join(official, `${name}.jpg`), path.join(target, `${name}.jpg`));
  results.push({ name, width: Number(header[1]), height: Number(header[2]), channels: 3, options: [], expectedStatus: name === "testimgari" ? 422 : 200, bytes: jpeg.byteLength, sha256: createHash("sha256").update(jpeg).digest("hex"), scanlineSha256: createHash("sha256").update(raw.subarray(header[0].length)).digest("hex") });
}
await copyFile(path.join(official, "LICENSE.txt"), path.join(target, "LICENSE.txt"));
await writeFile(path.join(target, "manifest.json"), JSON.stringify({ encoderVersion, oracleVersion, oracleOptions: ["-nosmooth", "-dct", "int", "-pnm"], officialSource: "https://github.com/libjpeg-turbo/libjpeg-turbo/releases/tag/3.2.0", syntheticFixtures: "ALTER에서 생성한 PGM/PPM 패턴", fixtures: results }, null, 2) + "\n");
console.log(JSON.stringify({ event: "jpeg_fixtures_prepared", fixtures: results.length }));
