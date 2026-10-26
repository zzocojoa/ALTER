"use client";
import type { ReactElement } from "react";
import { pngProbes, requirePngProbeResult } from "@/lib/materials/png-probe";
import { MaterialContentCheck } from "./material-content-check";
import type { ContentCheckCase } from "./material-content-check";

const cases: readonly ContentCheckCase[] = pngProbes.map((fixture): ContentCheckCase => ({ ...fixture, requireResult: (status: number, value: unknown): void => requirePngProbeResult(fixture, status, value) }));
export function MaterialPngCheck(): ReactElement {
  return <MaterialContentCheck suite={{ id: "material-png-result", title: "이미지 검증 환경", subject: "이미지", mime: "image/png", header: "x-png-probe", endpoint: "/api/storage/png-check", cases }} />;
}
