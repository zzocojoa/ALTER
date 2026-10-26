import { z } from "zod";
import { domainFailure, recordId, timestamp } from "../domain/contracts.ts";
import type { LearningContext } from "./learning-contract.ts";
import type { ModelRequest, RequestBound } from "./request-bound.ts";
import type { SourceExcerpt } from "../librarian/contracts.ts";
import type { VisionBinding } from "../extraction/vision-contract.ts";

export const coffeeProbeApproval = z.object({ id: recordId, courseId: recordId, approvedAt: timestamp, validUntil: timestamp,
  pages: z.array(z.object({ materialId: recordId, originalHash: z.string().regex(/^[a-f0-9]{64}$/), filePage: z.number().int().min(1).max(500) }).strict()).length(4),
}).strict().refine((value): boolean => value.validUntil > value.approvedAt && new Set(value.pages.map(page => page.materialId)).size === 4);
export type CoffeeProbeApproval = Readonly<z.infer<typeof coffeeProbeApproval>>;
export const coffeeProbeReceipt = z.object({ approvalId: recordId, logicalRequestKey: z.string().min(1).max(180), requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/), unitId: recordId.nullable(), kind: z.enum(["page-vision", "advisor-turn", "advisor-plan", "librarian-evaluation", "tutor-lesson", "tutor-diagnosis", "tutor-scaffold", "tutor-variation", "editor-draft-feedback", "editor-revision-review", "weekly-review"]) }).strict();
export type CoffeeProbeReceipt = Readonly<z.infer<typeof coffeeProbeReceipt>>;

export function requireCoffeePage(approval: CoffeeProbeApproval, binding: VisionBinding, now: number): void {
  requireCoffeeApproval(approval, now);
  if (!approval.pages.some(page => page.materialId === binding.materialId && page.originalHash === binding.originalHash && page.filePage === binding.filePage)) throw domainFailure("reference_conflict", "coffee.approved-page", null);
}
function requireCoffeeApproval(approval: CoffeeProbeApproval, now: number): void {
  coffeeProbeApproval.parse(approval);
  if (approval.approvedAt > now || approval.validUntil <= now) throw domainFailure("reference_conflict", "coffee.approval-expired", null);
}
function requireCoffeeSources(approval: CoffeeProbeApproval, sources: readonly SourceExcerpt[]): void {
  if (!sources.length || sources.some(source => !approval.pages.some(page => page.materialId === source.materialId && page.filePage === source.filePage))) throw domainFailure("reference_conflict", "coffee.selected-sources", null);
}
/** 지정한 네 원본 페이지와 한 과정의 실제 저장 문맥만 승인합니다. 다른 자료와 사진 답안은 포함하지 않습니다. */
export function coffeeProbeUnit(approval: CoffeeProbeApproval, context: LearningContext, request: ModelRequest, now: number): ReturnType<typeof recordId.parse> | null {
  requireCoffeeApproval(approval, now);
  const kind = request.responseContract;
  if (kind === "page-vision" && context.extractionPage) { requireCoffeePage(approval, context.extractionPage, now); return null; }
  if (request.messages.some(message => message.content.some(part => part.type === "input_image"))) throw domainFailure("reference_conflict", "coffee.unapproved-image", null);
  if ((kind === "advisor-turn" || kind === "advisor-plan") && context.advisor?.id === approval.courseId) return null;
  if (kind === "librarian-evaluation" && context.librarian?.unit.courseId === approval.courseId) {
    if (context.librarian.candidates.some(candidate => !approval.pages.some(page => page.materialId === candidate.link.materialId && page.originalHash === candidate.link.metadata.sha256))) throw domainFailure("reference_conflict", "coffee.candidate-original", null);
    requireCoffeeSources(approval, context.librarian.candidates.flatMap(candidate => candidate.sources));
    return context.librarian.unit.unitId;
  }
  if (kind && ["tutor-lesson", "tutor-diagnosis", "tutor-scaffold", "tutor-variation", "editor-draft-feedback", "editor-revision-review"].includes(kind) && context.tutor?.start.bundle.unit.courseId === approval.courseId) {
    requireCoffeeSources(approval, context.tutor.start.bundle.sources); return context.tutor.start.bundle.unit.unitId;
  }
  if (kind === "weekly-review" && context.weekly?.aggregate.courseId === approval.courseId && context.weekly.units.length === 1) {
    requireCoffeeSources(approval, context.weekly.sources); return context.weekly.units[0].unitId;
  }
  throw domainFailure("reference_conflict", "coffee.approved-course-and-kind", null);
}
/** 실제 토큰 집계가 계획 상한을 넘으면 생성·예약 전에 중단합니다. */
export function requireCoffeeBound(request: ModelRequest, bound: RequestBound): void {
  const kind = request.responseContract;
  const output = kind === "page-vision" ? 4096 : kind === "advisor-turn" ? 1800 : kind === "advisor-plan" ? 3000 : kind === "librarian-evaluation" || kind === "weekly-review" ? 6000 : 1400;
  if (!kind || !coffeeProbeReceipt.shape.kind.safeParse(kind).success || bound.inputTokenBound > 10000 || bound.outputTokenBound > output || request.reasoningEffort !== "none") throw domainFailure("limit_exceeded", "coffee.planned-token-bound", null);
}
