/** 브라우저에서만 합성 경계 PDF를 만들며 서버의 원본 버퍼 제한에는 영향을 주지 않습니다. */
export function acceptanceBoundaryPdf(size: number): Uint8Array<ArrayBuffer> {
  function assemble(padding: number): string {
    const bodies: readonly string[] = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /Resources << >> /MediaBox [0 0 612 792] >>", `<< /Length ${padding} >>\nstream\n${" ".repeat(padding)}\nendstream`];
    const header: string = "%PDF-1.7\n";
    const objects: readonly string[] = bodies.map((body: string, index: number): string => `${index + 1} 0 obj\n${body}\nendobj\n`);
    const offsets: readonly number[] = objects.map((_: string, index: number): number => header.length + objects.slice(0, index).reduce((sum: number, object: string): number => sum + object.length, 0));
    const xref: number = header.length + objects.reduce((sum: number, object: string): number => sum + object.length, 0);
    return `${header}${objects.join("")}xref\n0 5\n0000000000 65535 f \n${offsets.map((offset: number): string => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  }
  const provisional: number = size - 1024;
  const overhead: number = assemble(provisional).length - provisional;
  const bytes: Uint8Array<ArrayBuffer> = new TextEncoder().encode(assemble(size - overhead));
  if (bytes.length !== size) throw new Error("경계 PDF의 실제 크기가 요청과 다릅니다.");
  return bytes;
}
