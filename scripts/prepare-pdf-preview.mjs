import { cp, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** 버전이 고정된 PDF.js 브라우저 자원만 앱과 같은 출처에 준비합니다. */
export async function preparePdfPreview() {
  const installed = JSON.parse(await readFile(new URL("../node_modules/pdfjs-dist/package.json", import.meta.url), "utf8"));
  if (installed.version !== "6.4.299") throw new Error("PDF 미리보기 자원 버전이 고정 의존성과 다릅니다.");
  const source = new URL("../node_modules/pdfjs-dist/", import.meta.url);
  const target = path.resolve("public/pdfjs-6.4.299");
  await mkdir(target, { recursive: true });
  await copyFile(new URL("build/pdf.worker.min.mjs", source), path.join(target, "pdf.worker.min.mjs"));
  await writeFile(path.join(target, "worker-entry.mjs"), 'import "./pdf.worker.min.mjs";\nself.postMessage({ type: "alter-pdf-ready", version: "6.4.299" });\n');
  await copyFile(new URL("LICENSE", source), path.join(target, "LICENSE"));
  for (const directory of ["cmaps", "standard_fonts", "wasm", "iccs"]) await cp(new URL(directory, source), path.join(target, directory), { recursive: true });
}
