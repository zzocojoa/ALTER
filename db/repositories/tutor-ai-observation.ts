import { domainFailure } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import { tutorAiIntent, tutorAiObservation } from "../../lib/tutor/ai-observation.ts";
import type { TutorAiIntent, TutorAiObservation } from "../../lib/tutor/ai-observation.ts";
import { readAtomicReceipt, readStorage } from "./atomic.ts";
import { getTutor, previousTutor } from "./tutor.ts";

type CompletionRow = Readonly<{ requestId: string; version: number }>;
/** 원래 명령의 영수증과 같은 논리 키의 완료 사건만 조회하며 모델 실행이나 비용 예약을 하지 않습니다. */
export async function readTutorAiObservation(db: D1Database, owner: SiteIdentity, intent: TutorAiIntent): Promise<TutorAiObservation> {
  tutorAiIntent.parse(intent);
  const { input, key } = intent;
  if (input.action === "recover") throw domainFailure("validation", "tutor.ai-observation-new-request-required", null);
  const completionScope: string = input.action === "help" ? "tutor.help-complete" : input.action === "variation" ? "tutor.variation-complete" : "tutor.ai-complete";
  return readTutorTransitionObservation(db, owner, { key, input, beginScope: `tutor.${input.action}`, completionScope });
}

type AiTransitionObservation = Readonly<{ key: string; input: Readonly<{ id: string; expectedVersion: number }>; beginScope: string; completionScope: string }>;
/** 호출자가 정한 전이 종류의 시작 영수증과 같은 회차의 완료 사건만 연결합니다. */
export async function readTutorTransitionObservation(db: D1Database, owner: SiteIdentity, { key, input, beginScope, completionScope }: AiTransitionObservation): Promise<TutorAiObservation> {
  await getTutor(db, owner, input.id);
  const receipt = await readAtomicReceipt(db, { owner, requestKey: key, expectedVersion: input.expectedVersion }, beginScope, { id: input.id }, input.id);
  if (!receipt) return tutorAiObservation.parse({ key, status: "unobserved", logicalKey: null, requestId: null, version: null });
  const begun = await previousTutor(db, { owner, requestKey: key, expectedVersion: receipt.version }, input.id);
  if (!begun.pending || receipt.entityId !== input.id) throw domainFailure("reference_conflict", "tutor.ai-observation-begin-mismatch", null);
  const completed = await readStorage("tutor.ai-observation-complete", () => db.prepare("SELECT a.id AS requestId, e.version AS version FROM atomic_requests a JOIN tutor_events e ON e.owner_id=a.owner_id AND e.id=a.id WHERE a.owner_id=? AND a.scope=? AND a.request_key=? AND e.session_id=? AND e.version=?").bind(owner.userId, completionScope, `${begun.pending!.key}:complete`, input.id, receipt.version + 1).first<CompletionRow>());
  return tutorAiObservation.parse({ key, status: completed ? "completed" : "pending", logicalKey: begun.pending.key, requestId: receipt.requestId, version: completed?.version ?? receipt.version });
}
