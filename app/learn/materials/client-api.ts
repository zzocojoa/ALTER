import { googleReferenceProof } from "@/lib/google-reference/contract";
import { z } from "zod";
import { materialMetadata, materialKind, materialRole } from "@/lib/materials/policy";
import { transferState } from "@/lib/materials/transfer-state";
import type { MaterialLibrary } from "@/lib/materials/library";

const reference = z.object({ materialId: z.string().uuid(), kind: materialKind, role: materialRole, bytes: z.number(), pages: z.number(), sha256: z.string(), objectVersion: z.string(), sourceUrl: z.string().startsWith("/api/materials/") });
const pending = z.object({ id: z.string().uuid(), materialId: z.string().uuid(), version: z.number().int().positive(), state: transferState, metadata: materialMetadata });
export const transferReply = pending.omit({ metadata: true });
export const registrationReply = transferReply.extend({ state: z.literal("registered"), pages: z.number().int().positive() });
export const recoveryReply = transferReply.extend({ nextAction: z.enum(["upload", "cleanup", "registered", "new-upload"]) }).refine((value): boolean => value.nextAction === "upload" ? value.state === "reserved" : value.nextAction === "registered" ? value.state === "registered" : value.nextAction === "new-upload" ? value.state === "discarded" : !["registered", "discarded"].includes(value.state), "복구 응답의 상태가 일치하지 않아요.");
export const cleanupReply = transferReply.extend({ state: z.literal("discarded"), nextAction: z.literal("new-upload") });
const usageReply = z.object({ occupiedBytes: z.number(), reservedBytes: z.number(), untrackedBytes: z.number(), activeTransfers: z.number(), blocked: z.boolean() });
export const inventoryReply = z.object({ status: z.literal("verified"), checkedAt: z.number(), validUntil: z.number(), usage: usageReply, accountRemainingQuota: z.literal("unavailable"), probeReservationBytes: z.number() });
export const libraryReply = z.object({ materials: z.array(z.object({ id: z.string().uuid(), courseId: z.string().uuid(), metadata: materialMetadata, file: reference,googleSource:googleReferenceProof.nullable().optional() })), courses: z.array(z.object({ id: z.string().uuid(), title: z.string() })), pending: z.array(pending), usage: usageReply.nullable(), hidden: z.boolean(), hasMore: z.boolean(), cursor: z.string().nullable() });

export type MaterialResponseFailure = Error & Readonly<{ status: number; code: string; field: string | null }>;

export function isMaterialResponseFailure(error: unknown): error is MaterialResponseFailure {
  return error instanceof Error && error.name === "MaterialResponseFailure" && "status" in error && typeof error.status === "number" && "code" in error && typeof error.code === "string" && "field" in error && (error.field === null || typeof error.field === "string");
}

export async function requireMaterialResponse(response: Response): Promise<void> {
  if (response.ok) return;
  if (response.status === 401) throw Object.assign(new Error("로그인이 만료됐어요. 다시 로그인한 뒤 이어서 진행해 주세요. (401)"), { name: "MaterialResponseFailure", status: 401, code: "authentication_required", field: null });
  const body: string = await response.text();
  const value: unknown = body.length > 0 && response.headers.get("content-type")?.includes("application/json") ? JSON.parse(body) : { error: `http-${response.status}` };
  const error = z.object({ error: z.string(), field: z.string().optional() }).passthrough().parse(value);
  const message: string = error.field === "validation-timeout-retained" ? "내용 검증 시간이 초과됐어요. 원본과 예약은 보관했으니 상태 확인으로 이어서 진행해 주세요." : error.field === "material-hidden-during-recall" ? "자료를 가리고 답하는 중이에요. 답안을 제출한 뒤 원본을 열 수 있어요." : response.status === 403 ? "이 자료에 접근할 권한이 없어요." : response.status === 404 ? "확정된 자료를 찾을 수 없어요." : response.status === 413 ? "파일이 허용된 크기를 넘었어요." : response.status === 416 ? "요청한 원본 범위를 읽을 수 없어요. 목록을 새로 확인해 주세요." : response.status === 422 ? "파일 내용이 손상됐거나 지원하지 않는 형식이에요." : response.status === 409 ? "자료 상태가 변경됐거나 원본을 확인할 수 없어요. 목록을 새로 확인해 주세요." : response.status === 507 ? "자료 저장 한도를 넘었어요." : "요청을 마치지 못했어요. 저장 상태를 확인한 뒤 다시 진행해 주세요.";
  throw Object.assign(new Error(`${message} (${response.status} · ${error.error}${error.field ? ` · ${error.field}` : ""})`), { name: "MaterialResponseFailure", status: response.status, code: error.error, field: error.field ?? null });
}

export async function materialJson(url: string, init: RequestInit): Promise<unknown> {
  const response: Response = await fetch(url, { ...init, credentials: "same-origin", cache: "no-store" });
  await requireMaterialResponse(response);
  if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("서버 응답 형식이 달라요. 로그인 상태를 확인해 주세요.");
  return response.json();
}
export async function loadMaterialLibrary(cursor: string | null): Promise<MaterialLibrary> { return libraryReply.parse(await materialJson(`/api/materials${cursor === null ? "" : `?after=${encodeURIComponent(cursor)}`}`, { method: "GET" })); }
export function errorText(error: unknown): string { return error instanceof Error ? error.message : "알 수 없는 오류가 발생했어요. 목록을 새로 확인해 주세요."; }

export type MaterialFailure = Readonly<{ message: string; requiresLogin: boolean }>;

/** 인증 만료 응답일 때만 재로그인 동작을 안내합니다. */
export function materialFailure(error: unknown): MaterialFailure {
  return { message: errorText(error), requiresLogin: isMaterialResponseFailure(error) && error.status === 401 };
}
