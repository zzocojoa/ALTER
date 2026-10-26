import { readWeeklyEvidence } from "../../db/repositories/weekly-evidence";
import { supportedWeeklyClaims, requireWeeklyClaims } from "../../lib/weekly/claims";
import { requireCurrentTutor } from "../../lib/tutor/current";
import { runLibrarianFixture } from "./librarian-worker";
import { learningRuntimeFixture } from "./learning-ai-runtime";
import { tutorOutputFixture } from "./tutor-output";
import { createTutor,getTutor } from "../../db/repositories/tutor";
import { dispatchTutorAction,submitStoredTutorAnswer } from "../../db/repositories/tutor-actions";
import { beginStoredTutorAi,processTutorAi,tutorContext,tutorRequest,dispatchTutor } from "../../lib/tutor/ai";
import { readResultSnapshot } from "../../db/repositories/result-draft";
import { confirmSessionResult } from "../../db/repositories/result-confirmation";
import { readReviewPlans,chooseReviewSchedule } from "../../db/repositories/review-policy";
import { readReviewOverview } from "../../db/repositories/review-overview";
import { startReviewSession } from "../../db/repositories/review-session";
import { applyCorrection } from "../../db/repositories/reviews";
import { instant,seoulCalendarDate } from "../../lib/reviews/calendar";
import { recordId,seoulStudyDate } from "../../lib/domain/contracts";
import type { Command,SiteIdentity } from "../../lib/domain/contracts";
import { isDomainFailure } from "../../db/repositories/atomic";
function check(value:boolean,message:string):void {if(!value) throw new Error(message);}
async function denied(action:()=>Promise<unknown>,code:string):Promise<void> {try{await action();}catch(error:unknown){if(isDomainFailure(error) && error.code===code) return;throw error;}throw new Error(`거부 누락: ${code}`);}
async function counts(db:D1Database,owner:SiteIdentity):Promise<string> {const tables=["sessions","attempts","answers","tutor_sessions","learning_results","confirmed_results","result_next_actions","session_confirmations","result_review_targets","review_items","errors","review_plans","review_proposals","review_schedule","review_sessions","corrections","correction_impacts","atomic_requests","tutor_events"];const rows=await db.batch(tables.map((table)=>db.prepare(`SELECT * FROM ${table} WHERE owner_id=? ORDER BY rowid`).bind(owner.userId)));return JSON.stringify(rows.map((row)=>row.results));}
async function verify(db:D1Database,bucket:R2Bucket,owner:SiteIdentity,scopeId:string):Promise<readonly string[]> {
  const id=():ReturnType<typeof recordId.parse>=>recordId.parse(crypto.randomUUID());const cmd=(expectedVersion:number):Command=>({owner,expectedVersion,requestKey:crypto.randomUUID()});const base=Date.now();const at=(ms:number)=>instant.parse(new Date(ms).toISOString());
  const input={id:id(),scopeId,questionId:id(),attemptId:id()};await createTutor(db,bucket,cmd(1),input,base);let state=await getTutor(db,owner,input.id);
  const freshRepairId = id();
  const ai=learningRuntimeFixture(db,owner,async()=>tutorContext(await getTutor(db,owner,state.id)),async()=>{
    const current = await getTutor(db, owner, state.id);
    const output = tutorOutputFixture(current);
    return output.kind === "tutor-variation" && current.id === freshRepairId ? { ...output, prompt: "같은 크기 일곱 조각 중 셋을 분수로 쓰세요.", changedCondition: { before: current.question.prompt, after: "일곱 조각 중 셋", reason: "앞선 다섯 조각 중 둘과 다른 조건" } } : output;
  });
  async function generate(action:"diagnose"|"variation"):Promise<void>{await beginStoredTutorAi(db,bucket,cmd(state.version),state.id,action);state=await getTutor(db,owner,state.id);state=await processTutorAi(ai.runtime,bucket,owner,state.id,ai.pricing,tutorRequest(state,[]),dispatchTutor,new AbortController().signal);}
  async function submit(text:string,now:number):Promise<void>{await submitStoredTutorAnswer(db,bucket,cmd(state.version),state.id,id(),{text,fileIds:[]},now);state=await getTutor(db,owner,state.id);}
  async function confirm(now:number):Promise<void>{const snap=await readResultSnapshot(db,owner,state.id);try { await confirmSessionResult(db,cmd(state.version),{id:state.id,expectedVersion:state.version,expectedSessionVersion:snap.sessionVersion,expectedOfficialVersion:snap.draft.officialVersion,fingerprint:snap.draft.fingerprint},now); } catch (error: unknown) { throw new Error(JSON.stringify({ operation: "review-fixture-confirm", submittedText: state.answers.at(-1)?.text, performance: snap.draft.judgment.performance, delayedRecall: snap.draft.judgment.delayedRecall, correctionId: state.review?.correctionId }), { cause: error }); } state=await getTutor(db,owner,state.id);}
  await dispatchTutorAction(db,bucket,cmd(state.version),{action:"direct",id:state.id,expectedVersion:state.version},base);state=await getTutor(db,owner,state.id);await submit("분수는 같은 크기로 나눈 전체 중 선택한 부분입니다.",base+1);await generate("diagnose");await generate("variation");await submit("2/5",base+2);await generate("diagnose");await confirm(base+3);
  let plans=await readReviewPlans(db,owner,at(base+3),"Asia/Seoul");check(plans.length===1 && plans[0].decision.status==="proposed" && plans[0].proposal.stage===0,"확정과 첫 제안 연결 실패");let plan=plans[0];check(plan.evidence.answerId===state.currentAnswerId && plan.evidence.cause.status==="unverified","오답 원인 추측 또는 답안 참조 실패");check((await readReviewPlans(db,{realm:"sites",userId:"other"},at(base+3),"Asia/Seoul")).length===0,"다른 소유자 복습 노출");
  for(const patch of [{resultOrdinal:999},{resultVersionId:id()},{answerId:id()},{questionId:id()},{sourceRefIds:[id()]},{helpIds:[id()]}]) {
    const errorId=id();const reviewId=id();const bad={...plan.evidence,...patch};let rejected=false;
    try{await db.batch([db.prepare("INSERT INTO errors VALUES (?,?,1,?,?,?,?,?)").bind(owner.userId,errorId,"bad-evidence",plan.unitId,plan.evidence.answerId,plan.evidence.concept,"시험 오류"),db.prepare("INSERT INTO review_items VALUES (?,?,1,?,?,?,?,?,?,NULL,'required')").bind(owner.userId,reviewId,"bad-evidence",errorId,plan.sourceRefId,"질문","해설","다음 행동"),db.prepare("INSERT INTO result_review_targets VALUES (?,?,?,?,?,'variable','{}')").bind(owner.userId,id(),plan.evidence.resultVersionId,reviewId,plan.evidence.answerId),db.prepare("INSERT INTO review_plans VALUES (?,?,1,?,?,?,?)").bind(owner.userId,reviewId,"bad-evidence",JSON.stringify(bad),JSON.stringify(plan.task),id())]);}catch(error:unknown){if(!(error instanceof Error) || !error.message.includes("invalid_review_official_evidence")) throw error;rejected=true;}check(rejected,"잘못된 공식 오답 참조 허용");
  }
  const today=seoulStudyDate(base+4);const choice={id:plan.id,expectedVersion:plan.version,type:plan.task.type,conditions:plan.proposal.conditions,dueDate:today,reason:"당일 연습과 지연 재현 구분 검증"};await chooseReviewSchedule(db,cmd(plan.version),choice,base+4);plan=(await readReviewPlans(db,owner,at(base+4),"Asia/Seoul"))[0];
  const start={id:id(),reviewId:plan.id,expectedVersion:plan.version,questionId:id(),attemptId:id()};await startReviewSession(db,bucket,cmd(plan.version),start,base+5);state=await getTutor(db,owner,start.id);await submit("새 예시: 같은 크기 일곱 조각 중 셋\n자신의 설명: 일곱 조각 전체 중 세 조각인 3/7입니다.",base+6);await generate("diagnose");check((await readResultSnapshot(db,owner,state.id)).draft.judgment.delayedRecall==="미확인","당일 연습의 지연 재현 오인정");await dispatchTutorAction(db,bucket,cmd(state.version),{action:"finish",id:state.id,expectedVersion:state.version},base+7);
  const future=base+36*60*60*1000;const due=seoulStudyDate(future);const chosen={...choice,expectedVersion:plan.version,dueDate:due,reason:"다음 서울 날짜 시험"};const chooseCmd=cmd(plan.version);await chooseReviewSchedule(db,chooseCmd,chosen,base+6);await chooseReviewSchedule(db,chooseCmd,chosen,base+7);plan=(await readReviewPlans(db,owner,at(future),"Asia/Seoul"))[0];check(plan.dueState==="today","오늘 복습 분류 실패");check((await readReviewPlans(db,owner,at(future+86400000),"Asia/Seoul"))[0].dueState==="overdue","미제출 기한 경과 분류 실패");
  const beforeStart=await counts(db,owner);const next={...start,id:id(),questionId:id(),attemptId:id(),expectedVersion:plan.version};await db.prepare("CREATE TRIGGER review_start_fail BEFORE INSERT ON review_sessions BEGIN SELECT RAISE(ABORT,'review_start_fail'); END").run();await denied(()=>startReviewSession(db,bucket,cmd(plan.version),next,future),"reference_conflict");await db.prepare("DROP TRIGGER review_start_fail").run();check(await counts(db,owner)===beforeStart,"복습 시작 부분 커밋");
  const startCmd=cmd(plan.version);await startReviewSession(db,bucket,startCmd,next,future);await startReviewSession(db,bucket,startCmd,next,future+1);state=await getTutor(db,owner,next.id);await denied(()=>readReviewOverview(db,owner,at(future),"Asia/Seoul"),"reference_conflict");
  await denied(()=>submit("3/7",future+2),"validation");await submit("새 예시: 같은 크기 일곱 조각 중 셋\n자신의 설명: 전체를 같은 크기로 나눈 일곱 조각 중 셋을 뜻하는 3/7입니다.",future+3);
  const unconfirmed=await readResultSnapshot(db,owner,state.id);check(!unconfirmed.draft.canConfirm && unconfirmed.draft.judgment.delayedRecall==="미확인","미진단 답안의 지연 승격");await generate("diagnose");const snap=await readResultSnapshot(db,owner,state.id);check(snap.draft.judgment.delayedRecall==="확인" && snap.draft.canConfirm,"예정 독립 답안의 지연 판정 실패");
  const request={id:state.id,expectedVersion:state.version,expectedSessionVersion:snap.sessionVersion,expectedOfficialVersion:snap.draft.officialVersion,fingerprint:snap.draft.fingerprint};const before=await counts(db,owner);
  for(const table of ["review_proposals","confirmed_results","session_confirmations"]){await db.prepare(`CREATE TRIGGER review_commit_fail BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'review_commit_fail'); END`).run();await denied(()=>confirmSessionResult(db,cmd(state.version),request,future+4),"reference_conflict");await db.prepare("DROP TRIGGER review_commit_fail").run();check(await counts(db,owner)===before,`복습 확정 부분 커밋 ${table}`);}
  await db.prepare("CREATE TRIGGER review_zero BEFORE UPDATE ON review_plans BEGIN SELECT RAISE(IGNORE); END").run();await denied(()=>confirmSessionResult(db,cmd(state.version),request,future+4),"version_conflict");await db.prepare("DROP TRIGGER review_zero").run();check(await counts(db,owner)===before,"복습 0행 갱신 부분 커밋");
  const confirmCmd=cmd(state.version);const race=await Promise.all([confirmSessionResult(db,confirmCmd,request,future+4),confirmSessionResult(db,confirmCmd,request,future+4)]);check(JSON.stringify(race[0])===JSON.stringify(race[1]),"동시 확정 영수증 불일치");const after=await counts(db,owner);await confirmSessionResult(db,confirmCmd,request,future+5);check(await counts(db,owner)===after,"응답 유실 재전송 중복");await denied(()=>confirmSessionResult(db,confirmCmd,{...request,fingerprint:"b".repeat(64)},future+5),"request_key_reused");
  plans=await readReviewPlans(db,owner,at(future+6),"Asia/Seoul");plan=plans[0];check(plan.proposal.stage===1 && plan.proposal.baseDays===3 && plan.proposal.evidence?.answerId===state.currentAnswerId && plan.decision.status==="proposed","독립 통과 다음 간격과 근거 실패");check((await readResultSnapshot(db,owner,state.id)).draft.confirmation?.judgment.performance==="지연 재현","공식 지연 재현 누락");
  const history=await db.prepare("SELECT count(*) AS n FROM review_proposals WHERE owner_id=?").bind(owner.userId).first<number>("n");check(history===4,"제안 수락·변경 이력 소실");
  const priorConfirmedId: string = state.id;
  const activeDate: number = future + 36 * 60 * 60 * 1000;
  await chooseReviewSchedule(db, cmd(plan.version), { id: plan.id, expectedVersion: plan.version, type: "concept", conditions: plan.proposal.conditions, dueDate: seoulStudyDate(activeDate), reason: "진행 중 회차의 정정 경계 검사" }, future + 7);
  plan = (await readReviewPlans(db, owner, at(activeDate), "Asia/Seoul"))[0];
  const active = { id: id(), reviewId: plan.id, expectedVersion: plan.version, questionId: id(), attemptId: id() };
  await startReviewSession(db, bucket, cmd(plan.version), active, activeDate);
  state = await getTutor(db, owner, active.id);
  await submit("새 예시: 같은 크기 여섯 조각 중 하나\n자신의 설명: 전체 여섯 조각 중 한 조각을 뜻하는 1/6입니다.", activeDate + 1);
  await generate("diagnose");
  const activeSnapshot = await readResultSnapshot(db, owner, state.id);
  check(activeSnapshot.draft.canConfirm, "정정 전 진행 회차 확정 가능 근거 누락");
  const courseId: string = state.start.bundle.unit.courseId;
  const sourceIds: readonly string[] = state.start.bundle.sources.map(source => source.id);
  const beforeWeekly = await readWeeklyEvidence(db, owner, courseId, seoulStudyDate(future));
  const beforeClaims = supportedWeeklyClaims(beforeWeekly.aggregate, sourceIds);
  check(beforeClaims.some(claim => claim.kind === "delayed-recall"), "정정 전 지연 재현 주간 근거 없음");
  const correction={id:id(),errorId:plan.errorId,concept:plan.evidence.concept,sourceRefId:plan.sourceRefId,answerId:plan.evidence.answerId,studyDate:seoulCalendarDate(at(activeDate+2),"Asia/Seoul"),createdAt:activeDate+2,reason:"잘못된 설명 정정 시험",evidence:"같은 크기로 나눈 전체",targets:[{reviewId:plan.id,expectedVersion:plan.reviewVersion,question:"정정 후 새 조건에서 설명하세요.",explanation:"같은 크기로 나눈다는 조건을 확인해요.",nextAction:"정정된 내용으로 새 수행을 확인하세요."}]};
  const originalAnswers=JSON.stringify((await db.prepare("SELECT * FROM answers WHERE owner_id=? ORDER BY id").bind(owner.userId).all()).results);await applyCorrection(db,cmd(plan.errorVersion),correction);const corrected=(await readReviewPlans(db,owner,at(future+8),"Asia/Seoul"))[0];check(corrected.dueState==="recheck" && corrected.reviewVersion===plan.reviewVersion+1 && corrected.nextAction.includes("새 수행"),"정정 전파 누락");check(originalAnswers===JSON.stringify((await db.prepare("SELECT * FROM answers WHERE owner_id=? ORDER BY id").bind(owner.userId).all()).results),"과거 답안 변경");check((await readResultSnapshot(db,owner,priorConfirmedId)).draft.confirmation?.judgment.performance==="지연 재현","정정이 과거 확정 증거를 삭제함");
  await denied(() => requireCurrentTutor(db, bucket, owner, state), "reference_conflict");
  const stale = await readResultSnapshot(db, owner, state.id);
  check(!stale.draft.canConfirm && stale.draft.judgment.delayedRecall === "미확인", "정정 전 진행 회차의 오래된 답안 승격");
  await denied(() => confirmSessionResult(db, cmd(state.version), { id: state.id, expectedVersion: state.version, expectedSessionVersion: activeSnapshot.sessionVersion, expectedOfficialVersion: activeSnapshot.draft.officialVersion, fingerprint: activeSnapshot.draft.fingerprint }, activeDate + 3), "version_conflict");
  const correctedWeekly = await readWeeklyEvidence(db, owner, courseId, seoulStudyDate(future));
  check(correctedWeekly.aggregate.answers.length > 0 && correctedWeekly.aggregate.answers.every(answer => answer.needsRecheck) && correctedWeekly.aggregate.counts.delayedRecall === 0, "정정 전 지연 재현의 주간 승격 유지");
  await denied(async () => requireWeeklyClaims(beforeClaims, correctedWeekly.aggregate, sourceIds), "reference_conflict");
  await dispatchTutorAction(db, bucket, cmd(state.version), { action: "finish", id: state.id, expectedVersion: state.version }, activeDate + 4);
  check((await getTutor(db, owner, active.id)).answers.at(-1)?.text === state.answers.at(-1)?.text, "정정된 회차 종료 시 원본 답안 소실");
  const repairDate=activeDate+1000;await chooseReviewSchedule(db,cmd(corrected.version),{id:corrected.id,expectedVersion:corrected.version,type:"concept",conditions:corrected.proposal.conditions,dueDate:seoulStudyDate(repairDate),reason:"정정 뒤 새 조건 재확인"},repairDate);const repairPlan=(await readReviewPlans(db,owner,at(repairDate),"Asia/Seoul"))[0];const repair={id:id(),reviewId:repairPlan.id,expectedVersion:repairPlan.version,questionId:id(),attemptId:id()};await startReviewSession(db,bucket,cmd(repairPlan.version),repair,repairDate+1);state=await getTutor(db,owner,repair.id);await submit("새 예시: 같은 크기 열 조각 중 세 조각\n자신의 설명: 전체를 같은 크기로 나누어야 합니다.",repairDate+2);await generate("diagnose");await generate("variation");await submit("같은 크기의 다섯 조각 전체 중 둘이므로 2/5입니다.",repairDate+3);await generate("diagnose");const repaired=await readResultSnapshot(db,owner,state.id);check(repaired.draft.canConfirm,"정정 후 실제 새 조건의 확정 차단");await confirm(repairDate+4);let afterRepair=(await readReviewPlans(db,owner,at(repairDate+5),"Asia/Seoul"))[0];
  check(afterRepair.recheckState === "required" && afterRepair.proposal.outcome === "retry" && afterRepair.proposal.stage === repairPlan.proposal.stage, "이미 풀었던 질문의 새 ID를 정정 재확인 성공으로 승격");
  const duplicateWeekly = await readWeeklyEvidence(db, owner, courseId, seoulStudyDate(repairDate));
  check(duplicateWeekly.aggregate.counts.correctionRechecks === 0 && duplicateWeekly.aggregate.counts.independentNewConditions === 0, "재사용 질문의 주간 독립 수행 승격");
  await chooseReviewSchedule(db, cmd(afterRepair.version), { id: afterRepair.id, expectedVersion: afterRepair.version, type: "concept", conditions: afterRepair.proposal.conditions, dueDate: seoulStudyDate(repairDate), reason: "실제로 처음 보는 조건으로 정정 재확인" }, repairDate + 6);
  const freshPlan = (await readReviewPlans(db, owner, at(repairDate + 6), "Asia/Seoul"))[0];
  await startReviewSession(db, bucket, cmd(freshPlan.version), { id: freshRepairId, reviewId: freshPlan.id, expectedVersion: freshPlan.version, questionId: id(), attemptId: id() }, repairDate + 7);
  state = await getTutor(db, owner, freshRepairId);
  await submit("새 예시: 같은 크기 열두 조각 중 다섯 조각\n자신의 설명: 분모는 전체의 같은 크기 조각 수이며 분자는 선택한 수입니다.", repairDate + 8);
  await generate("diagnose"); await generate("variation");
  await submit("전체를 같은 크기 일곱 조각으로 나누고 셋을 골랐으므로 3/7입니다.", repairDate + 9);
  await generate("diagnose"); await confirm(repairDate + 10);
  afterRepair = (await readReviewPlans(db, owner, at(repairDate + 11), "Asia/Seoul"))[0];
  check(afterRepair.recheckState === "independent" && afterRepair.proposal.outcome === "independent-pass", "정정 후 실제 새 조건 재확인 누락");
  const repairedWeekly = await readWeeklyEvidence(db, owner, courseId, seoulStudyDate(repairDate));
  const repairedClaims = supportedWeeklyClaims(repairedWeekly.aggregate, sourceIds);
  check(repairedWeekly.aggregate.counts.correctionRechecks === 1 && repairedWeekly.aggregate.counts.delayedRecall === 0 && repairedClaims.some(claim => claim.kind === "correction-recheck" && claim.correctionId === correction.id && claim.answerId === state.currentAnswerId), JSON.stringify({ failure: "weekly-correction-recheck", counts: repairedWeekly.aggregate.counts, claims: repairedClaims, expectedAnswer: state.currentAnswerId, correctionId: correction.id, answers: repairedWeekly.aggregate.answers.map(answer => ({ id: answer.id, accepted: answer.accepted, mode: answer.mode, correctionId: answer.correctionId, correctionRechecked: answer.correctionRechecked, needsRecheck: answer.needsRecheck })) }));
  check(repairedClaims.every(claim => claim.kind !== "delayed-recall"), "즉시 재확인을 주간 지연 재현으로 승격");
  requireWeeklyClaims(repairedClaims, repairedWeekly.aggregate, sourceIds);
  const delayedDate: number = repairDate + 36 * 60 * 60 * 1000;
  await chooseReviewSchedule(db, cmd(afterRepair.version), { id: afterRepair.id, expectedVersion: afterRepair.version, type: "concept", conditions: afterRepair.proposal.conditions, dueDate: seoulStudyDate(delayedDate), reason: "별도 서울 날짜의 정정 후 지연 재현" }, repairDate + 12);
  const delayedPlan = (await readReviewPlans(db, owner, at(delayedDate), "Asia/Seoul"))[0];
  const delayedInput = { id: id(), reviewId: delayedPlan.id, expectedVersion: delayedPlan.version, questionId: id(), attemptId: id() };
  await startReviewSession(db, bucket, cmd(delayedPlan.version), delayedInput, delayedDate);
  state = await getTutor(db, owner, delayedInput.id);
  await submit("새 예시: 같은 크기 아홉 조각 중 네 조각\n자신의 설명: 4/9에서 분모 9는 전체를 나눈 같은 크기의 조각 수이고 분자 4는 고른 조각 수입니다.", delayedDate + 1);
  await generate("diagnose"); await confirm(delayedDate + 2);
  afterRepair = (await readReviewPlans(db, owner, at(delayedDate + 3), "Asia/Seoul"))[0];
  const delayedWeekly = await readWeeklyEvidence(db, owner, courseId, seoulStudyDate(delayedDate));
  const delayedClaims = supportedWeeklyClaims(delayedWeekly.aggregate, sourceIds);
  check(afterRepair.recheckState === "delayed" && delayedWeekly.aggregate.counts.delayedRecall === 1 && delayedClaims.some(claim => claim.kind === "delayed-recall" && claim.answerId === state.currentAnswerId), "별도 학습일의 실제 저장 답안과 주간 지연 근거 연결 실패");
  requireWeeklyClaims(delayedClaims, delayedWeekly.aggregate, sourceIds);
  const retryDate=delayedDate+36*60*60*1000;await chooseReviewSchedule(db,cmd(afterRepair.version),{id:afterRepair.id,expectedVersion:afterRepair.version,type:"concept",conditions:afterRepair.proposal.conditions,dueDate:seoulStudyDate(retryDate),reason:"실패 전이 모의 검증"},retryDate);const retryPlan=(await readReviewPlans(db,owner,at(retryDate),"Asia/Seoul"))[0];const retry={id:id(),reviewId:retryPlan.id,expectedVersion:retryPlan.version,questionId:id(),attemptId:id()};await startReviewSession(db,bucket,cmd(retryPlan.version),retry,retryDate+1);state=await getTutor(db,owner,retry.id);await submit("새 예시: 모르겠습니다\n자신의 설명: 모르겠습니다",retryDate+2);await generate("diagnose");check((await readResultSnapshot(db,owner,state.id)).draft.judgment.delayedRecall==="미확인","과거 지연 성공을 이번 실패 답안의 성공으로 재사용");await confirm(retryDate+3);const failed=(await readReviewPlans(db,owner,at(retryDate+4),"Asia/Seoul"))[0];check(failed.proposal.stage===retryPlan.proposal.stage && failed.proposal.adjustedDays===1 && failed.proposal.outcome==="retry","실패가 단계 승격 또는 당일 강제 반복됨");
  return ["review-failed-later-attempt-does-not-reuse-prior-delayed-success","review-corrected-later-seoul-date-delayed-answer-weekly-claim","review-reused-question-new-id-no-correction-or-interval-promotion","review-active-session-correction-invalidates-old-answer-and-confirmation","review-correction-preserves-abandoned-session-answer","review-weekly-old-delayed-claims-invalidated-by-correction","review-weekly-correction-recheck-linked-without-delayed-promotion","review-wrong-result-ordinal-answer-question-source-help-denied","review-correction-real-new-condition-recheck","review-failed-confirmed-outcome-no-promotion-next-seoul-day","review-confirmed-result-answer-version-and-unknown-cause","review-first-proposal-no-forced-schedule","review-owner-list-isolation","review-same-seoul-date-practice-allowed-without-delayed-credit","review-today-overdue-unsubmitted-distinct","review-accept-change-history-and-replay","review-start-full-rollback-and-replay","review-hidden-recall-no-overview-leak","review-type-missing-fields-denied","review-no-diagnosis-no-delayed-promotion","review-scheduled-later-date-confirmed-unassisted-delayed","review-three-failures-full-rollback","review-zero-update-full-rollback","review-concurrency-response-loss-single-receipt","review-payload-key-conflict","review-next-interval-evidence-linked","review-correction-question-explanation-next-action-recheck","review-original-answers-and-delayed-history-preserved"];
}
async function fetch(request:Request,env:Readonly<{DB:D1Database;BUCKET:R2Bucket}>):Promise<Response>{try{return await runLibrarianFixture(request,env,verify);}catch(error:unknown){if(!(error instanceof Error)) throw error;const causes:string[]=[];let current:unknown=error;while(current instanceof Error){causes.push(current.message);current=current.cause;}return Response.json({causes},{status:500});}}
const worker={fetch};export default worker;
