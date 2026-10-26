"use client";
import type { ReactElement } from "react";
import { pdfProbes, requirePdfProbeResult } from "@/lib/materials/pdf-probe";
import { MaterialContentCheck } from "./material-content-check";
import type { ContentCheckCase } from "./material-content-check";

const cases: readonly ContentCheckCase[] = pdfProbes.map((fixture): ContentCheckCase => ({ ...fixture, requireResult: (status: number, value: unknown): void => requirePdfProbeResult(fixture, status, value) }));
export function MaterialPdfCheck(): ReactElement {
  return <MaterialContentCheck suite={{ id: "material-pdf-result", title: "PDF 검증 환경", subject: "PDF", mime: "application/pdf", header: "x-pdf-probe", endpoint: "/api/storage/pdf-check", cases }} />;
}
