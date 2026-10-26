"use client";
import type { ReactElement } from "react";
import { textProbes, requireTextProbeResult } from "@/lib/materials/text-probe";
import { MaterialContentCheck } from "./material-content-check";
import type { ContentCheckCase } from "./material-content-check";

const cases: readonly ContentCheckCase[] = textProbes.map((fixture): ContentCheckCase => ({ ...fixture, requireResult: (status: number, value: unknown): void => requireTextProbeResult(fixture, status, value) }));
export function MaterialTextCheck(): ReactElement {
  return <MaterialContentCheck suite={{ id: "material-text-result", title: "텍스트 검증 환경", subject: "텍스트", mime: "text/plain", header: "x-text-probe", endpoint: "/api/storage/text-check", cases }} />;
}
