import { z } from "zod";
import { domainFailure, timestamp } from "../domain/contracts.ts";
import { materialMetadata, materialPolicy } from "./policy.ts";
import type { MaterialMetadata } from "./policy.ts";

export const transferState = z.enum(["reserved", "transferring", "stored", "validating", "verified", "registered", "failed", "unknown", "cleaning", "discarded"]);
export const writeStatus = z.enum(["not-started", "active", "succeeded", "aborted", "unknown"]);
const objectFact = z.object({ objectVersion: z.string().min(1), etag: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().positive() }).strict();
export const contentFact = objectFact.extend({ pages: z.number().int().positive().max(500), kind: z.enum(["pdf", "image", "text"]), policyVersion: z.literal(materialPolicy.version) }).strict();
export type ObjectFact = Readonly<z.infer<typeof objectFact>>;
export type ContentFact = Readonly<z.infer<typeof contentFact>>;
export const transferEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start") }).strict(),
  z.object({ type: z.literal("multipart-created"), multipartId: z.string().min(1) }).strict(),
  z.object({ type: z.literal("write-succeeded"), object: objectFact }).strict(),
  z.object({ type: z.literal("write-unknown"), reason: z.string().min(1).max(200) }).strict(),
  z.object({ type: z.literal("write-aborted"), reason: z.string().min(1).max(200) }).strict(),
  z.object({ type: z.literal("cancel-before-parts") }).strict(),
  z.object({ type: z.literal("validate") }).strict(),
  z.object({ type: z.literal("revalidate-jpeg") }).strict(),
  z.object({ type: z.literal("revalidate-pdf") }).strict(),
  z.object({ type: z.literal("content-verified"), content: contentFact }).strict(),
  z.object({ type: z.literal("content-failed"), reason: z.string().min(1).max(200) }).strict(),
  z.object({ type: z.literal("register") }).strict(),
  z.object({ type: z.literal("cleanup") }).strict(),
  z.object({ type: z.literal("deleted") }).strict(),
]);
export type TransferEvent = Readonly<z.infer<typeof transferEvent>>;
export const transferSnapshot = z.object({
  state: transferState, writeStatus, multipartId: z.string().nullable(), object: objectFact.nullable(), validation: contentFact.nullable(), failureCode: z.string().nullable(), updatedAt: timestamp,
}).strict();
export type TransferSnapshot = Readonly<z.infer<typeof transferSnapshot>>;

function requireState(condition: boolean, event: TransferEvent): void {
  if (!condition) throw domainFailure("reference_conflict", `material.${event.type}`, null);
}

/** 쓰기와 원본 식별이 확정된 JPEG·PDF 내용 실패만 같은 예약으로 다시 검사합니다. */
export function canRevalidateMaterial(current: TransferSnapshot, metadata: MaterialMetadata): boolean {
  const failedContent: boolean = metadata.mime === "image/jpeg" && (current.failureCode === "content-or-object-invalid" || current.failureCode?.startsWith("material_content_invalid:jpeg:") === true) || metadata.mime === "application/pdf" && current.failureCode?.startsWith("material_content_invalid:pdf:") === true;
  return current.state === "failed" && current.writeStatus === "succeeded" && current.validation === null && current.object !== null && current.object.bytes === metadata.bytes && current.object.sha256 === metadata.sha256 && failedContent;
}

/** 시간 경과로 쓰기 종료를 추정하지 않으며 R2 완료 또는 abort 관측이 필요합니다. */
export function evolveTransfer(value: TransferSnapshot, input: TransferEvent, metadata: MaterialMetadata, now: number): TransferSnapshot {
  const current: TransferSnapshot = transferSnapshot.parse(value);
  const event: TransferEvent = transferEvent.parse(input);
  materialMetadata.parse(metadata); timestamp.parse(now);
  requireState(now >= current.updatedAt && !["registered", "discarded"].includes(current.state), event);
  switch (event.type) {
    case "start":
      requireState(current.state === "reserved" && current.writeStatus === "not-started", event);
      return { ...current, state: "transferring", writeStatus: "active", updatedAt: now };
    case "multipart-created":
      requireState(current.state === "transferring" && current.writeStatus === "active" && current.multipartId === null, event);
      return { ...current, multipartId: event.multipartId, updatedAt: now };
    case "write-succeeded":
      requireState(["transferring", "unknown"].includes(current.state) && ["active", "unknown"].includes(current.writeStatus) && current.multipartId !== null && event.object.bytes === metadata.bytes && event.object.sha256 === metadata.sha256, event);
      return { ...current, state: "stored", writeStatus: "succeeded", object: event.object, failureCode: null, updatedAt: now };
    case "write-unknown":
      requireState(["transferring", "unknown"].includes(current.state) && ["active", "unknown"].includes(current.writeStatus), event);
      return { ...current, state: "unknown", writeStatus: "unknown", failureCode: event.reason, updatedAt: now };
    case "write-aborted":
      requireState(["transferring", "unknown"].includes(current.state) && ["active", "unknown"].includes(current.writeStatus) && current.multipartId !== null, event);
      return { ...current, state: "failed", writeStatus: "aborted", failureCode: event.reason, updatedAt: now };
    case "cancel-before-parts":
      requireState(["transferring", "unknown"].includes(current.state) && ["active", "unknown"].includes(current.writeStatus) && current.multipartId === null, event);
      return { ...current, state: "failed", writeStatus: "aborted", failureCode: "cancelled-before-durable-multipart", updatedAt: now };
    case "validate":
      requireState(["stored", "validating"].includes(current.state) && current.writeStatus === "succeeded", event);
      return { ...current, state: "validating", updatedAt: now };
    case "revalidate-jpeg":
      requireState(metadata.mime === "image/jpeg" && canRevalidateMaterial(current, metadata), event);
      return { ...current, state: "validating", updatedAt: now };
    case "revalidate-pdf":
      requireState(metadata.mime === "application/pdf" && canRevalidateMaterial(current, metadata), event);
      return { ...current, state: "validating", updatedAt: now };
    case "content-verified":
      requireState(current.state === "validating" && current.object !== null && event.content.objectVersion === current.object.objectVersion && event.content.etag === current.object.etag && event.content.bytes === metadata.bytes && event.content.sha256 === metadata.sha256 && event.content.kind === metadata.kind && event.content.pages <= materialPolicy.types[metadata.kind].maximumPages, event);
      return { ...current, state: "verified", validation: event.content, failureCode: null, updatedAt: now };
    case "content-failed":
      requireState(["stored", "validating"].includes(current.state), event);
      return { ...current, state: "failed", failureCode: event.reason, updatedAt: now };
    case "register":
      requireState(current.state === "verified" && current.validation !== null, event);
      return { ...current, state: "registered", updatedAt: now };
    case "cleanup":
      requireState(["reserved", "stored", "validating", "verified", "failed", "cleaning"].includes(current.state) && ["not-started", "aborted", "succeeded"].includes(current.writeStatus), event);
      return { ...current, state: "cleaning", updatedAt: now };
    case "deleted":
      requireState(current.state === "cleaning", event);
      return { ...current, state: "discarded", updatedAt: now };
  }
}

/** 등록 전에는 기존 학습 저장소의 verified 상태를 발급하지 않습니다. */
export function legacyUploadState(state: z.infer<typeof transferState>): "reserved" | "object-written" | "verified" | "unknown" | "missing" | "quarantined" {
  if (state === "registered") return "verified";
  if (state === "discarded") return "missing";
  if (state === "unknown") return "unknown";
  if (state === "failed" || state === "cleaning") return "quarantined";
  return ["stored", "validating", "verified"].includes(state) ? "object-written" : "reserved";
}
