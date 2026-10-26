import pdf from "../../lib/materials/pdf-wasm/validator.wasm";
import jpeg from "../../lib/materials/jpeg-wasm/decoder.wasm";
import { recordId } from "../../lib/domain/contracts";
import type { Command } from "../../lib/domain/contracts";
import { createUnit, createPlan, savePlanDraft, confirmPlan } from "../../db/repositories/courses";
import { createSession, createQuestion, startAttempt, submitAnswer } from "../../db/repositories/sessions";
import { completeMaterialTransfer } from "../../lib/materials/complete";
import { uploadMaterialBody } from "../../lib/materials/upload";
import { getMaterialTransfer } from "../../db/repositories/material-transfers";
import { recordMaterialExposure, requireMaterialVisibility, attachAnswerFile } from "../../db/repositories/material-access";
import { materialFileReference } from "../../lib/materials/attachment";
import { initializeUploadFixture } from "./material-transfer-setup";

async function reject(operation: () => Promise<unknown>, expected: RegExp): Promise<void> {
  try { await operation(); } catch (error: unknown) { if (error instanceof Error && expected.test(error.message)) return; throw error; }
  throw new Error("거부해야 할 자료 접근이 성공했습니다.");
}
function ensure(value: boolean, reason: string): void { if (!value) throw new Error(reason); }
async function fetch(request: Request, environment: Readonly<{ DB: D1Database; BUCKET: R2Bucket }>): Promise<Response> {
  const { DB, BUCKET } = environment;
  const { owner, id } = await initializeUploadFixture(DB, request);
  const context = (expectedVersion: number): Command => ({ owner, requestKey: crypto.randomUUID(), expectedVersion });
  const uuid = (): ReturnType<typeof recordId.parse> => recordId.parse(crypto.randomUUID());
  const uploaded = await uploadMaterialBody(DB, BUCKET, owner, id, 1, request);
  await completeMaterialTransfer(DB, BUCKET, owner, id, uploaded.version, { pdf, jpeg }, request.signal);
  const transfer = await getMaterialTransfer(DB, owner, id);
  const reference = materialFileReference(transfer);
  ensure(!JSON.stringify(reference).includes(transfer.objectKey), "파일 참조에 저장 키 포함");
  const unitId = uuid(), planId = uuid(), planVersionId = uuid(), sessionId = uuid(), questionId = uuid(), attemptId = uuid(), answerId = uuid();
  const courseId = recordId.parse(transfer.courseId);
  await createUnit(DB, context(1), { id: unitId, courseId, ordinal: 1, title: "자료 접근 검사" });
  await createPlan(DB, context(1), { id: planId, courseId, title: "자료 접근 검사" });
  await savePlanDraft(DB, context(1), planId, { objective: "노출 이력 확인", unitIds: [unitId], minutesPerWeek: 60 });
  await confirmPlan(DB, context(2), planId, planVersionId, Date.now());
  await createSession(DB, context(1), { id: sessionId, courseId, unitId, planVersionId, studyDate: "2026-10-24" });
  await createQuestion(DB, context(1), { id: questionId, sessionId, sourceRefId: null, prompt: "자료 확인" });
  await startAttempt(DB, context(1), { id: attemptId, sessionId, questionId, originalQuestionId: null, mode: "initial", hiddenMaterial: false });
  await Promise.all([recordMaterialExposure(DB, owner, transfer), recordMaterialExposure(DB, owner, transfer)]);
  await recordMaterialExposure(DB, owner, transfer);
  const count = (table: "material_exposures" | "help_events" | "answer_files"): Promise<number | null> => DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE owner_id=?`).bind(owner.userId).first<number>("n");
  ensure(await count("material_exposures") === 1 && await count("help_events") === 1, "동시 범위 요청 노출 중복");
  await reject(() => DB.prepare("UPDATE material_exposures SET shown_at=shown_at+1 WHERE owner_id=?").bind(owner.userId).run(), /immutable/);
  await reject(() => DB.prepare("DELETE FROM material_exposures WHERE owner_id=?").bind(owner.userId).run(), /immutable/);
  await submitAnswer(DB, context(2), { id: answerId, attemptId, text: "답안", submittedAt: Date.now() });
  const fileContext: Command = context(1);
  const linkedAt: number = Date.now();
  if (transfer.metadata.role === "answer") {
    await attachAnswerFile(DB, fileContext, answerId, transfer.materialId, linkedAt);
    await attachAnswerFile(DB, fileContext, answerId, transfer.materialId, linkedAt);
    ensure(await count("answer_files") === 1, "답안 파일 연결 중복");
    await reject(() => DB.prepare("UPDATE answer_files SET linked_at=linked_at+1 WHERE owner_id=?").bind(owner.userId).run(), /immutable/);
    await reject(() => DB.prepare("DELETE FROM answer_files WHERE owner_id=?").bind(owner.userId).run(), /immutable/);
    await reject(() => attachAnswerFile(DB, { ...context(1), owner: { ...owner, userId: "other" } }, answerId, transfer.materialId, linkedAt), /reference_conflict/);
  } else await reject(() => attachAnswerFile(DB, fileContext, answerId, transfer.materialId, linkedAt), /reference_conflict/);
  const hiddenQuestion = uuid(), hiddenAttempt = uuid();
  await createQuestion(DB, context(1), { id: hiddenQuestion, sessionId, sourceRefId: null, prompt: "자료 없이 설명" });
  await startAttempt(DB, context(1), { id: hiddenAttempt, sessionId, questionId: hiddenQuestion, originalQuestionId: null, mode: "initial", hiddenMaterial: true });
  await reject(() => requireMaterialVisibility(DB, owner), /material-hidden-during-recall/);
  await reject(() => recordMaterialExposure(DB, owner, transfer), /material-hidden-during-recall/);
  ensure(await count("help_events") === 1, "거부된 접근이 도움을 추가함");
  return Response.json({ status: "passed", checks: transfer.metadata.role === "answer" ? 10 : 7, objectKey: transfer.objectKey, role: transfer.metadata.role, exposureCount: 1, helpCount: 1, attached: await count("answer_files") });
}
const worker = { fetch };
export default worker;
