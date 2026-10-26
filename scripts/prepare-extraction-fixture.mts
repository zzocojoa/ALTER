import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { pdfObjects, pdfStream } from "../tests/fixtures/pdf-bytes.ts";

const texts: readonly string[] = ["BT /F1 24 Tf 40 700 Td (ALTER selected-page test) Tj 0 -50 Td (Contents: page 3 - formula and table) Tj ET", "BT /F1 24 Tf 40 700 Td (UNSELECTED_SENTINEL_PAGE_2) Tj ET", "BT /F1 24 Tf 40 700 Td (Pythagorean theorem) Tj 0 -50 Td (a^2 + b^2 = c^2) Tj 0 -60 Td (a       b       c) Tj 0 -40 Td (3       4       5) Tj ET 35 605 260 30 re S 35 565 260 40 re S 35 525 260 40 re S 110 525 m 110 635 l S 200 525 m 200 635 l S"];
const bytes: Uint8Array = pdfObjects(["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>", ...texts.map((_, index): string => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 9 0 R >> >> /Contents ${index + 6} 0 R >>`), ...texts.map((text): Uint8Array => { const data: Buffer = Buffer.from(text); return pdfStream("", data, data.length); }), "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]);
await mkdir("public/acceptance", { recursive: true });
await writeFile("public/acceptance/alter-selected-pages.pdf", bytes);
await writeFile("lib/extraction/acceptance-fixture.ts", `/** 소유자가 승인한 고정 시험 자료만 미확정 원화 소액 검증에 허용합니다. */\nexport const extractionAcceptanceHash: string = "${createHash("sha256").update(bytes).digest("hex")}";\nexport const extractionAcceptancePage: number = 3;\n`);
console.log(JSON.stringify({ bytes: bytes.length, pages: 3, visionPage: 3 }));
