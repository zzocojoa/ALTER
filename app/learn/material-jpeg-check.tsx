"use client";
import type { ReactElement } from "react";
import { jpegProbes, requireJpegProbeResult } from "@/lib/materials/jpeg-probe";
import { MaterialContentCheck } from "./material-content-check";
import type { ContentCheckCase } from "./material-content-check";

const cases: readonly ContentCheckCase[] = jpegProbes.map((fixture): ContentCheckCase => ({ ...fixture, requireResult: (status: number, value: unknown): void => requireJpegProbeResult(fixture, status, value) }));
export function MaterialJpegCheck(): ReactElement {
  return <MaterialContentCheck suite={{ id: "material-jpeg-result", title: "JPEG 검증 환경", subject: "이미지", mime: "image/jpeg", header: "x-jpeg-probe", endpoint: "/api/storage/jpeg-check", cases }} />;
}
