import { pdfObjects, pdfStream } from "./pdf-bytes";
import type { PdfObject } from "./pdf-bytes";

/** 공개 가능한 합성 문서로 텍스트·이미지·빈 페이지·혼합·벡터·주석·클리핑을 재현합니다. */
export function extractionPdf(): Uint8Array {
  const content: readonly string[] = [
    "BT /F1 24 Tf 50 700 Td (Synthetic text) Tj ET",
    "q 100 0 0 100 0 0 cm /Im0 Do Q",
    "",
    "BT /F1 24 Tf 50 700 Td (Text and image) Tj ET q 100 0 0 100 0 0 cm /Im0 Do Q",
    "q 0 0 10 10 re S Q",
    "",
    "q 0 0 100 100 re W n Q",
  ];
  const pages: readonly string[] = content.map((_entry: string, index: number): string => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 17 0 R >> /XObject << /Im0 18 0 R >> >> /Contents ${10 + index} 0 R ${index === 5 ? "/Annots [19 0 R]" : ""} >>`);
  const streams: readonly Uint8Array[] = content.map((entry: string): Uint8Array => { const bytes: Buffer = Buffer.from(entry); return pdfStream("", bytes, bytes.length); });
  const whiteImage: Buffer = Buffer.alloc(16, 255);
  const objects: readonly PdfObject[] = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R 6 0 R 7 0 R 8 0 R 9 0 R] /Count 7 >>", ...pages, ...streams, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", pdfStream("/Type /XObject /Subtype /Image /Width 4 /Height 4 /ColorSpace /DeviceGray /BitsPerComponent 8", whiteImage, whiteImage.length), "<< /Type /Annot /Subtype /Text /Rect [10 10 30 30] /Contents (Synthetic note) /P 8 0 R >>"];
  return pdfObjects(objects);
}
