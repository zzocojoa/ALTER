import { deflateSync } from "node:zlib";

export type PdfObject = string | Uint8Array;
export function pdfObjects(objects: readonly PdfObject[]): Uint8Array {
  const header: Buffer = Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n", "latin1");
  const encoded: readonly Buffer[] = objects.map((body: PdfObject, index: number): Buffer => Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), typeof body === "string" ? Buffer.from(body, "latin1") : body, Buffer.from("\nendobj\n")]));
  const offsets: readonly number[] = encoded.map((_: Buffer, index: number): number => header.length + encoded.slice(0, index).reduce((sum: number, entry: Buffer): number => sum + entry.length, 0));
  const xref: number = header.length + encoded.reduce((sum: number, entry: Buffer): number => sum + entry.length, 0);
  return Buffer.concat([header, ...encoded, Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset: number): string => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)]);
}
export function pdfStream(dictionary: string, bytes: Uint8Array, declaredLength: number): Uint8Array { return Buffer.concat([Buffer.from(`<< ${dictionary} /Length ${declaredLength} >>\nstream\n`), bytes, Buffer.from("\nendstream")]); }
export function contentPdf(stream: Uint8Array): Uint8Array {
  return pdfObjects(["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /Resources << >> /MediaBox [0 0 612 792] /Contents 4 0 R >>", stream]);
}
export function textPdf(): Uint8Array { const content: Buffer = Buffer.from("q 0 0 10 10 re S Q\n"); const compressed: Buffer = deflateSync(content); return contentPdf(pdfStream("/Filter /FlateDecode", compressed, compressed.length)); }
export function pageTreePdf(count: number, declaredCount: number): Uint8Array { return pdfObjects(["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${Array.from({ length: count }, (_: unknown, index: number): string => `${index + 3} 0 R`).join(" ")}] /Count ${declaredCount} >>`, ...Array.from({ length: count }, (): string => "<< /Type /Page /Parent 2 0 R /Resources << >> /MediaBox [0 0 612 792] >>")]); }
export function scannedPdf(image: Uint8Array, filter: string, width: number, height: number): Uint8Array {
  const content: Buffer = Buffer.from("q 100 0 0 100 0 0 cm /Im0 Do Q\n");
  return pdfObjects(["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>", pdfStream("", content, content.length), pdfStream(`/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter ${filter}`, image, image.length)]);
}
export function sizedPdf(bytes: number): Uint8Array {
  function assemble(paddingBytes: number): Uint8Array {
    const padding: Buffer = Buffer.alloc(paddingBytes, 32);
    return pdfObjects(["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /Resources << >> /MediaBox [0 0 612 792] >>", pdfStream("/Type /EmbeddedFile", padding, padding.length)]);
  }
  const provisional: number = bytes - 1024;
  if (provisional < 0) throw new RangeError("크기 경계 PDF는 1024바이트 이상이어야 합니다.");
  const overhead: number = assemble(provisional).length - provisional;
  const result: Uint8Array = assemble(bytes - overhead);
  if (result.length !== bytes) throw new RangeError("PDF 고정 크기 생성 결과가 요청과 다릅니다.");
  return result;
}

/** 실제 문자 그리기를 포함해 페이지별 텍스트 추출을 검사합니다. */
export function readablePdf(count: number): Uint8Array {
  const pages: readonly string[] = Array.from({ length: count }, (_: unknown, index: number): string => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${3 + count * 2} 0 R >> >> /Contents ${3 + count + index} 0 R >>`);
  const streams: readonly Uint8Array[] = Array.from({ length: count }, (_: unknown, index: number): Uint8Array => { const bytes: Buffer = Buffer.from(`BT /F1 24 Tf 50 700 Td (ALTER page ${index + 1}) Tj ET`); return pdfStream("", bytes, bytes.length); });
  return pdfObjects(["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${pages.map((_: string, index: number): string => `${3 + index} 0 R`).join(" ")}] /Count ${count} >>`, ...pages, ...streams, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]);
}
