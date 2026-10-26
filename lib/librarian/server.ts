import { env } from "cloudflare:workers";
import { z } from "zod";
import { getStudyScope, listStudyScopes, requireCurrentScope } from "../../db/repositories/study-scopes";
import { listConfirmedUnits, listMaterialLinks, inspectMaterialLink, readPrerequisiteStates } from "../../db/repositories/librarian-links";
import { isDomainFailure, readStorage } from "../../db/repositories/atomic";
import { recordMaterialExposure, requireMaterialVisibility } from "../../db/repositories/material-access";
import { sourceExcerpt } from "./contracts";
import type { CandidateSnapshot, ConfirmedUnit, PrerequisiteState, ScopeState, SourceExcerpt } from "./contracts";
import { librarianContext, librarianRequest } from "./ai";
import { resolveExtractionSource } from "../extraction/source-server";
import { readMaterialLibrary } from "../materials/library";
import type { MaterialCard, MaterialLibrary } from "../materials/library";
import { getRegisteredMaterial } from "../materials/download";
import { materialFileReference } from "../materials/attachment";
import { headMaterialObject } from "../materials/object";
import { requireAiConfiguration } from "../ai/configuration";
import type { AiConfiguration } from "../ai/configuration";
import { ownerAiRuntime, waitForRetry } from "../ai/server";
import { requireAiSupport } from "../ai/support";
import type { AiRunRuntime } from "../ai/run";
import { prepareAiRequest } from "../ai/request-bound";
import { domainFailure, recordId, seoulStudyDate } from "../domain/contracts";
import type { SiteIdentity } from "../domain/contracts";
import { privateJson } from "../owner-access";
import { materialErrorResponse } from "../materials/server-access";

export type ScopeSummary = Readonly<{ id: string; version: number; title: string; date: string; phase: ScopeState["phase"] }>;
export type LibrarianOverview = Readonly<{ units: readonly ConfirmedUnit[]; states: readonly PrerequisiteState[]; links: readonly CandidateSnapshot[]; history: readonly ScopeSummary[]; library: MaterialLibrary; today: string; unitId: string | null }>;
export function librarianConfiguration(): AiConfiguration { return requireAiConfiguration(env.ALTER_AI_CONFIGURATION); }
export async function librarianRuntime(configuration: AiConfiguration, state: ScopeState): Promise<AiRunRuntime> {
  const prepared = await prepareAiRequest(librarianRequest(state));
  return { ...ownerAiRuntime(configuration), wait: waitForRetry, warn: (warning): void => console.warn(warning),
    authorizeSources: async (owner, request): Promise<void> => {
      const current = await getStudyScope(env.DB, owner, state.input.id);
      if (current.version !== state.version || request.requestFingerprint !== prepared.requestFingerprint || request.imageCount !== 0) throw domainFailure("version_conflict", "librarian.ai.input-changed", null);
      await requireCurrentScope(env.DB, env.BUCKET, owner, current);
    },
    loadContext: async (owner) => {
      const current = await getStudyScope(env.DB, owner, state.input.id);
      if (current.version !== state.version || current.pendingKey !== state.pendingKey) throw domainFailure("version_conflict", "librarian.ai.context-changed", null);
      await requireCurrentScope(env.DB, env.BUCKET, owner, current); return librarianContext(current);
    },
    requireSupport: async (owner, _request, now): Promise<void> => {
      if (owner.userId !== configuration.funding.ownerId) throw domainFailure("reference_conflict", "librarian.ai.funding-owner", null);
      requireAiSupport(configuration.support, ["text", "structured-output", "usage", "output-limit"], configuration.funding.accountFingerprint, now);
    },
  };
}
export async function readLibrarianOverview(owner: SiteIdentity, unitId: string | null): Promise<LibrarianOverview> {
  await requireMaterialVisibility(env.DB, owner);
  const units = await listConfirmedUnits(env.DB, owner);
  const chosen = unitId === null ? units[0] : units.find((unit): boolean => unit.unitId === unitId);
  if (unitId !== null && !chosen) throw domainFailure("reference_conflict", "librarian.unit-selection", null);
  const links = chosen ? await listMaterialLinks(env.DB, owner, chosen.planVersionId, chosen.unitId) : [];
  const candidates = await Promise.all(links.map((link) => inspectMaterialLink(env.DB, env.BUCKET, owner, link)));
  for (const id of new Set(candidates.filter((item): boolean => item.valid).map((item): string => item.link.materialId))) await recordMaterialExposure(env.DB, owner, await getRegisteredMaterial(env.DB, owner, id));
  return { units, states: await readPrerequisiteStates(env.DB, owner, units.map((unit): string => unit.unitId)), links: candidates, history: (await listStudyScopes(env.DB, owner)).map((state): ScopeSummary => ({ id: state.input.id,version: state.version,title: state.unit.title,date: state.input.date,phase: state.phase })), library: await readMaterialLibrary(env.DB, owner, null), today: seoulStudyDate(Date.now()), unitId: chosen?.unitId ?? null };
}
export async function readScopeView(owner: SiteIdentity, id: string): Promise<Readonly<{ scope: ScopeState; current: boolean; issue: string | null }>> {
  const scope = await getStudyScope(env.DB, owner, id);
  let issue: string | null = null;
  try { await requireCurrentScope(env.DB, env.BUCKET, owner, scope); }
  catch (error: unknown) { if (!isDomainFailure(error) || !["reference_conflict", "version_conflict"].includes(error.code)) throw error; issue = "계획·원문·수행 기록이 바뀌었어요. 이전 제안은 보관되며 새 범위를 선택해야 해요."; }
  for (const id of new Set(scope.candidates.map((item): string => item.link.materialId))) await recordMaterialExposure(env.DB, owner, await getRegisteredMaterial(env.DB, owner, id));
  return { scope, current: issue === null, issue };
}
export async function readMaterialSourceChoices(owner: SiteIdentity, materialId: string): Promise<Readonly<{ material: MaterialCard; sources: readonly SourceExcerpt[]; more: boolean }>> {
  recordId.parse(materialId); await requireMaterialVisibility(env.DB, owner);
  const transfer = await getRegisteredMaterial(env.DB, owner, materialId); await headMaterialObject(env.BUCKET, transfer); await recordMaterialExposure(env.DB, owner, transfer);
  const rows = await readStorage("librarian.source-choices", () => env.DB.prepare("SELECT s.id FROM source_references s JOIN extraction_sources e ON e.owner_id=s.owner_id AND e.source_id=s.id JOIN extraction_pages p ON p.owner_id=e.owner_id AND p.result_id=e.result_id JOIN extraction_jobs j ON j.owner_id=p.owner_id AND j.id=p.job_id WHERE s.owner_id=? AND s.material_id=? AND p.state='complete' AND j.version=p.selection_revision ORDER BY s.rowid DESC LIMIT 51").bind(owner.userId, materialId).all<{ id: string }>());
  const judgments = await Promise.all(rows.results.slice(0,50).map((row) => resolveExtractionSource(env.DB, env.BUCKET, owner, row.id)));
  return { material: { id: transfer.materialId,courseId: transfer.courseId,metadata: transfer.metadata,file: materialFileReference(transfer) }, sources: judgments.flatMap((item): SourceExcerpt[] => item.valid ? [sourceExcerpt.parse(item.source)] : []), more: rows.results.length > 50 };
}
export function librarianErrorResponse(error: unknown): Response {
  if (error instanceof z.ZodError) return privateJson({ error: "librarian_input_invalid",message: error.issues[0].message,field: error.issues[0].path.join(".") }, 400);
  if (isDomainFailure(error)) return privateJson({ error: error.code,operation: error.operation,message: error.code === "limit_exceeded" ? "시간·자료 크기 또는 비용 한도를 확인해 주세요." : error.code === "result_unknown" ? "기존 요청의 결과를 확정하지 못했어요. 새 호출 없이 기존 요청 확인을 사용해 주세요." : "계획·구간·수행 기록이나 저장 버전이 달라졌어요. 최신 기록과 원본을 확인하고 범위를 다시 선택해 주세요." }, ["storage_failure", "result_unknown"].includes(error.code) ? 503 : 409);
  if (error instanceof Error && "code" in error && typeof error.code === "string" && error.code.startsWith("ai_")) return privateJson({ error: error.code,message: "AI 가격·잔액·지원 조건을 확인해 주세요. 원화 비용 설정이 미확정이면 일반 자료의 AI 비교는 차단돼요." }, 503);
  return materialErrorResponse(error);
}
