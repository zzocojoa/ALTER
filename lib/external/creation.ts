import { z } from "zod";
import { canonicalJson, contentHash, recordId } from "../domain/contracts.ts";

const jsonSnapshot = z.string().min(2).max(400_000).transform((value: string): string => canonicalJson(JSON.parse(value)));
const key = z.string().min(1).max(200);
export const externalOperationSeed = z.object({ stepKind: key, kind: key, businessKey: key, requestSnapshot: jsonSnapshot, expectedSnapshot: jsonSnapshot, externalId: z.string().min(1).max(1024).nullable() }).strict();
export const externalWorkflowSeed = z.object({ jobId: recordId.nullable(), kind: z.enum(["weekly-export", "calendar"]), targetKey: key, sourceVersion: key, predecessorId: recordId.nullable(), operations: z.array(externalOperationSeed).min(1).max(40) }).strict().refine(value => value.kind !== "weekly-export" || value.jobId !== null, "주간 내보내기는 확정된 주간 작업 ID가 필요합니다.").refine(value => new Set(value.operations.map(operation => operation.businessKey)).size === value.operations.length, "단계의 업무 키가 중복되었습니다.");
export type ExternalOperationSeed = Readonly<z.infer<typeof externalOperationSeed>>;
export type ExternalWorkflowSeed = Readonly<z.infer<typeof externalWorkflowSeed>>;
export type ExternalOperationPlan = Readonly<{ stepKind: string; kind: string; businessKey: string; snapshot: string; requestHash: string; expectedHash: string; externalId: string | null }>;
export type ExternalCreationPlan = Readonly<{ seed: ExternalWorkflowSeed; requestHash: string; snapshot: string; operations: readonly ExternalOperationPlan[] }>;

/** 난수 ID·요청 키·연결 세대는 내용 지문에서 제외하고 Google 계정과 확정 버전은 포함합니다. */
export async function prepareExternalCreation(value: ExternalWorkflowSeed, googleSubject: string): Promise<ExternalCreationPlan> {
  const seed: ExternalWorkflowSeed = externalWorkflowSeed.parse(value); key.parse(googleSubject);
  const operations: readonly ExternalOperationPlan[] = await Promise.all(seed.operations.map(async (operation: ExternalOperationSeed): Promise<ExternalOperationPlan> => {
    const request: unknown = JSON.parse(operation.requestSnapshot); const expected: unknown = JSON.parse(operation.expectedSnapshot);
    return { stepKind: operation.stepKind, kind: operation.kind, businessKey: operation.businessKey, snapshot: canonicalJson({ request, expected }), requestHash: await contentHash(request), expectedHash: await contentHash(expected), externalId: operation.externalId };
  }));
  const content = { kind: seed.kind, targetKey: seed.targetKey, sourceVersion: seed.sourceVersion, predecessorId: seed.predecessorId, operations: seed.operations };
  return { seed, operations, requestHash: await contentHash({ ...content, googleSubject }), snapshot: canonicalJson({ format: 1, predecessorId: seed.predecessorId }) };
}
