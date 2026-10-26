import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { download, exists, run } from "./native-build-tools.mts";

type Archive = Readonly<{ version: string; url: string; sha256: string }>;
type BuildDependencies = Readonly<{ libjpeg: Archive; emsdk: Archive & Readonly<{ commit: string }>; cmake: Readonly<{ version: string; macosWheel: string; sha256: string }> }>;
const root: string = process.cwd();
const dependencies: BuildDependencies = JSON.parse(await readFile("native/jpeg/dependencies.json", "utf8"));
const cache: string = path.join(root, ".sites-runtime/jpeg-build");
const sdk: string = path.join(cache, `emsdk-${dependencies.emsdk.commit}`);
const jpeg: string = path.join(cache, `libjpeg-turbo-${dependencies.libjpeg.version}`);
const build: string = path.join(cache, "jpeg-build");
const output: string = path.join(root, "lib/materials/jpeg-wasm");
await mkdir(cache, { recursive: true });
await mkdir(output, { recursive: true });

/** 도구와 원본은 체크아웃의 무시된 폴더에만 설치하며 배포에는 생성한 디코더만 포함합니다. */
for (const item of [dependencies.emsdk, dependencies.libjpeg]) {
  const archive: string = path.join(cache, `${item.sha256}.tar.gz`);
  await download(item.url, archive, item.sha256);
  const extracted: string = item === dependencies.emsdk ? sdk : jpeg;
  if (!await exists(extracted)) run("tar", ["-xzf", archive, "-C", cache], root, process.env);
}
run("python3", [path.join(sdk, "emsdk.py"), "install", dependencies.emsdk.version], sdk, process.env);
run("python3", [path.join(sdk, "emsdk.py"), "activate", dependencies.emsdk.version], sdk, process.env);
if (process.platform !== "darwin") throw new Error("이 빌드 준비 스크립트는 현재 macOS 도구 해시만 고정합니다. 다른 호스트용 공식 CMake 배포를 먼저 고정해야 합니다.");
const wheel: string = path.join(cache, "cmake.whl");
await download(dependencies.cmake.macosWheel, wheel, dependencies.cmake.sha256);
run("python3", ["-m", "zipfile", "-e", wheel, path.join(cache, "cmake")], root, process.env);
const cmake: string = path.join(cache, "cmake/cmake/data/bin/cmake");
run("chmod", ["+x", cmake], root, process.env);
const emscripten: string = path.join(sdk, "upstream/emscripten");
const environment: NodeJS.ProcessEnv = { ...process.env, EM_CONFIG: path.join(sdk, ".emscripten"), PATH: `${path.dirname(cmake)}:${emscripten}:${process.env.PATH ?? ""}` };
run(path.join(emscripten, "emcmake"), [cmake, "-S", jpeg, "-B", build, "-DCMAKE_BUILD_TYPE=Release", "-DENABLE_SHARED=OFF", "-DENABLE_STATIC=ON", "-DWITH_SIMD=OFF", "-DWITH_TURBOJPEG=OFF", "-DWITH_ARITH_DEC=OFF", "-DWITH_ARITH_ENC=OFF", "-DWITH_TESTS=OFF", "-DWITH_TOOLS=OFF", "-DBUILD=20261024"], root, environment);
run(cmake, ["--build", build, "--target", "jpeg-static", "-j", "4"], root, environment);
run(path.join(emscripten, "emcc"), ["native/jpeg/decoder.c", path.join(build, "libjpeg.a"), "-I", path.join(jpeg, "src"), "-I", build, "-O3", "-sMODULARIZE=1", "-sEXPORT_ES6=1", "-sENVIRONMENT=web,worker", "-sFILESYSTEM=0", "-sALLOW_MEMORY_GROWTH=1", "-sINITIAL_MEMORY=2097152", "-sMAXIMUM_MEMORY=67108864", "-sSTACK_SIZE=65536", "-sABORTING_MALLOC=0", "-sEXPORTED_RUNTIME_METHODS=HEAPU8", "-o", path.join(output, "decoder.js")], root, environment);
for (const filename of ["LICENSE.md", "README.ijg", "README.md"]) await copyFile(path.join(jpeg, filename), path.join(output, filename));
const files: readonly string[] = ["decoder.js", "decoder.wasm"];
const digests = await Promise.all(files.map(async (file: string): Promise<Readonly<{ file: string; sha256: string; bytes: number }>> => { const bytes: Buffer = await readFile(path.join(output, file)); return { file, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.byteLength }; }));
await writeFile(path.join(output, "build.json"), JSON.stringify({ libjpeg: dependencies.libjpeg, emsdk: dependencies.emsdk.version, wrapperSha256: createHash("sha256").update(await readFile("native/jpeg/decoder.c")).digest("hex"), supported: "8-bit Huffman sequential and progressive; arithmetic, lossless, and other precisions rejected", maximumMemoryBytes: 67108864, inputWindowBytes: 65536, files: digests }, null, 2) + "\n");
console.log(JSON.stringify({ event: "jpeg_decoder_built", files: digests }));
