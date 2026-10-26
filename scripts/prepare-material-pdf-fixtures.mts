import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { contentPdf, pageTreePdf, pdfStream, scannedPdf, sizedPdf, textPdf } from "../tests/fixtures/pdf-bytes.ts";

type Fixture = Readonly<{ id: string; title: string; bytes: Uint8Array; status: number; pages: number | null; field: string | null }>;
const compressed: Buffer = deflateSync(Buffer.from("q Q\n"));
const corrupt: Buffer = Buffer.concat([compressed.subarray(0, compressed.length - 1), Buffer.from([compressed[compressed.length - 1] ^ 1])]);
const cases: readonly Fixture[] = [
  { id: "text", title: "텍스트 PDF", bytes: textPdf(), status: 200, pages: 1, field: null },
  { id: "scanned-jpeg", title: "스캔 PDF 구조", bytes: scannedPdf(await readFile("tests/fixtures/jpeg/gray.jpg"), "/DCTDecode", 17, 19), status: 200, pages: 1, field: null },
  { id: "object-stream", title: "객체·xref 스트림", bytes: await readFile("tests/fixtures/pdf/object-stream.pdf"), status: 200, pages: 1, field: null },
  { id: "incremental", title: "증분 저장", bytes: await readFile("tests/fixtures/pdf/incremental-3.pdf"), status: 200, pages: 1, field: null },
  { id: "pages-500", title: "500페이지", bytes: pageTreePdf(500, 500), status: 200, pages: 500, field: null },
  { id: "size-20mib", title: "20MiB 원본", bytes: sizedPdf(20971520), status: 200, pages: 1, field: null },
  { id: "count-forged", title: "페이지 수 위조 거부", bytes: pageTreePdf(2, 1), status: 422, pages: null, field: "pdf:page-tree-count-mismatch" },
  { id: "flate-adler", title: "압축 체크섬 손상 거부", bytes: contentPdf(pdfStream("/Filter /FlateDecode", corrupt, corrupt.length)), status: 422, pages: null, field: "pdf:stream-decode-failed" },
  { id: "pages-501", title: "501페이지 거부", bytes: pageTreePdf(501, 501), status: 422, pages: null, field: "pdf:page-tree-count" },
];
await mkdir("public/diagnostics/pdf", { recursive: true });
const manifest = [];
for (const fixture of cases) {
  const url: string = `/diagnostics/pdf/${fixture.id}.pdf`;
  await writeFile(`public${url}`, fixture.bytes);
  manifest.push({ id: fixture.id, title: fixture.title, url, bytes: fixture.bytes.length, sha256: createHash("sha256").update(fixture.bytes).digest("hex"), status: fixture.status, pages: fixture.pages, field: fixture.field });
}
await copyFile("tests/fixtures/pdf/LICENSE.txt", "public/diagnostics/pdf/LICENSE.txt");
await writeFile("lib/materials/pdf-probes.json", JSON.stringify(manifest, null, 2) + "\n");
