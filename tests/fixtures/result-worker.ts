import { readSessionResume } from "../../db/repositories/session-resume";
import { runLibrarianFixture } from "./librarian-worker";
import { learningRuntimeFixture } from "./learning-ai-runtime";
import { tutorOutputFixture } from "./tutor-output";
import { createTutor,getTutor } from "../../db/repositories/tutor";
import { dispatchTutorAction,submitStoredTutorAnswer } from "../../db/repositories/tutor-actions";
import { beginStoredTutorAi,processTutorAi,tutorContext,tutorRequest,dispatchTutor } from "../../lib/tutor/ai";
import { readResultSnapshot } from "../../db/repositories/result-draft";
import { confirmSessionResult } from "../../db/repositories/result-confirmation";
import { applyCorrection } from "../../db/repositories/reviews";
import { recordId,seoulStudyDate } from "../../lib/domain/contracts";
import type { Command,SiteIdentity } from "../../lib/domain/contracts";
import type { ResultRequest } from "../../lib/results/contracts";
import { isDomainFailure } from "../../db/repositories/atomic";
function check(value:boolean,message:string):void {if(!value) throw new Error(message);}
async function denied(action:()=>Promise<unknown>,code:string):Promise<void> {try{await action();}catch(error:unknown){if(isDomainFailure(error) && error.code===code) return;throw error;}throw new Error(`거부 누락: ${code}`);}
async function counts(db:D1Database,owner:SiteIdentity):Promise<string> {
  const tables=["sessions","tutor_sessions","learning_results","confirmed_results","result_next_actions","session_confirmations","result_review_targets","review_plans","review_proposals","review_schedule","review_sessions","review_items","errors","atomic_requests","tutor_events"];
  const values=await db.batch(tables.map((table)=>db.prepare(`SELECT * FROM ${table} WHERE owner_id=? ORDER BY rowid`).bind(owner.userId)));return JSON.stringify(values.map((value)=>value.results));
}
async function verify(db:D1Database,bucket:R2Bucket,owner:SiteIdentity,scopeId:string):Promise<readonly string[]> {
  const id=():ReturnType<typeof recordId.parse>=>recordId.parse(crypto.randomUUID());const cmd=(expectedVersion:number):Command=>({owner,expectedVersion,requestKey:crypto.randomUUID()});
  const input={id:id(),scopeId,questionId:id(),attemptId:id()};await createTutor(db,bucket,cmd(1),input,Date.now());let state=await getTutor(db,owner,input.id);
  await dispatchTutorAction(db,bucket,cmd(state.version),{action:"direct",id:input.id,expectedVersion:state.version},Date.now());
  await denied(()=>readResultSnapshot(db,owner,input.id),"reference_conflict");state=await getTutor(db,owner,input.id);
  await submitStoredTutorAnswer(db,bucket,cmd(state.version),input.id,id(),{text:"분수는 전체를 같은 크기로 나눈 것 중 선택한 부분입니다.",fileIds:[]},Date.now());
  const ai=learningRuntimeFixture(db,owner,async()=>tutorContext(await getTutor(db,owner,input.id)),async()=>tutorOutputFixture(await getTutor(db,owner,input.id)));
  async function generate(action:"diagnose"|"variation"):Promise<void> {state=await getTutor(db,owner,input.id);await beginStoredTutorAi(db,bucket,cmd(state.version),input.id,action);state=await getTutor(db,owner,input.id);state=await processTutorAi(ai.runtime,bucket,owner,input.id,ai.pricing,tutorRequest(state,[]),dispatchTutor,new AbortController().signal);}
  await generate("diagnose");await generate("variation");await submitStoredTutorAnswer(db,bucket,cmd(state.version),input.id,id(),{text:"2/5",fileIds:[]},Date.now());await generate("diagnose");
  const before=await counts(db,owner);const snapshot=await readResultSnapshot(db,owner,input.id);await readResultSnapshot(db,owner,input.id);check(await counts(db,owner)===before,"조회만으로 공식 기록 변경");check(snapshot.draft.judgment.unitPassed && snapshot.draft.judgment.delayedRecall==="미확인","두 수행 증거 통과 실패");
  await denied(()=>readResultSnapshot(db,{realm:"sites",userId:"other"},input.id),"reference_conflict");
  const request:ResultRequest={id:input.id,expectedVersion:state.version,expectedSessionVersion:snapshot.sessionVersion,expectedOfficialVersion:snapshot.draft.officialVersion,fingerprint:snapshot.draft.fingerprint};
  for(const table of ["confirmed_results","result_next_actions","session_confirmations","result_review_targets","review_plans","review_proposals","tutor_events"]) {
    await db.prepare(`CREATE TRIGGER result_failure BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'result_failure'); END`).run();await denied(()=>confirmSessionResult(db,cmd(state.version),request,Date.now()),"reference_conflict");await db.prepare("DROP TRIGGER result_failure").run();check(await counts(db,owner)===before,`부분 커밋: ${table}`);
  }
  await db.prepare("CREATE TRIGGER result_zero BEFORE UPDATE ON sessions BEGIN SELECT RAISE(IGNORE); END").run();await denied(()=>confirmSessionResult(db,cmd(state.version),request,Date.now()),"version_conflict");await db.prepare("DROP TRIGGER result_zero").run();check(await counts(db,owner)===before,"0행 갱신 부분 커밋");
  await denied(()=>confirmSessionResult(db,cmd(state.version),{...request,fingerprint:"f".repeat(64)},Date.now()),"version_conflict");
  for(const mutation of ["UPDATE tutor_sessions SET version=version+1,state=json_set(state,'$.version',version+1)","UPDATE attempts SET hidden_material=0"]) {
    await db.prepare(`CREATE TRIGGER result_race BEFORE INSERT ON atomic_requests WHEN NEW.scope='session.confirm' BEGIN ${mutation}; END`).run();await denied(()=>confirmSessionResult(db,cmd(state.version),request,Date.now()),"version_conflict");await db.prepare("DROP TRIGGER result_race").run();check(await counts(db,owner)===before,"계산 후 증거 변경이 부분 커밋됨");
  }
  const competing=[cmd(state.version),cmd(state.version)];const race=await Promise.allSettled(competing.map((command)=>confirmSessionResult(db,command,request,Date.now())));check(race.filter((item)=>item.status==="fulfilled").length===1,"다른 키 동시 확정이 한 건이 아님");const winner=race.findIndex((item)=>item.status==="fulfilled");const confirmation=competing[winner];
  const concurrent=await Promise.all([confirmSessionResult(db,confirmation,request,Date.now()),confirmSessionResult(db,confirmation,request,Date.now())]);check(JSON.stringify(concurrent[0])===JSON.stringify(concurrent[1]),"동일 요청 결과 다름");
  const saved=await readResultSnapshot(db,owner,input.id);check(saved.draft.confirmation!==null && saved.draft.confirmation.judgment.unitPassed && saved.draft.latest?.progress==="완료" && saved.draft.reviews.length===1,"공식 확정 묶음 누락");
  const after=await counts(db,owner);await confirmSessionResult(db,confirmation,request,Date.now());check(await counts(db,owner)===after,"재전송이 새 기록 생성");
  await denied(()=>confirmSessionResult(db,confirmation,{...request,expectedOfficialVersion:1},Date.now()),"request_key_reused");await denied(()=>confirmSessionResult(db,cmd(state.version),request,Date.now()),"version_conflict");
  for(const table of ["session_confirmations","result_review_targets"]) await denied(async()=>{try{await db.prepare(`DELETE FROM ${table} WHERE owner_id=?`).bind(owner.userId).run();}catch(error:unknown){if(error instanceof Error && /immutable/.test(error.message)) throw Object.assign(new Error("불변 확인"),{code:"reference_conflict",operation:"test"});throw error;}},"reference_conflict");
  const review=await db.prepare("SELECT r.id,r.version,r.error_id AS errorId,e.answer_id AS answerId,e.concept,r.source_ref_id AS sourceRefId FROM review_items r JOIN errors e ON e.owner_id=r.owner_id AND e.id=r.error_id WHERE r.owner_id=? LIMIT 1").bind(owner.userId).first<{id:string;version:number;errorId:string;answerId:string;concept:string;sourceRefId:string}>();if(!review) throw new Error("복습 대상 누락");
  await applyCorrection(db,cmd(1),{id:id(),errorId:recordId.parse(review.errorId),concept:review.concept,sourceRefId:recordId.parse(review.sourceRefId),answerId:recordId.parse(review.answerId),studyDate:seoulStudyDate(Date.now()),createdAt:Date.now(),reason:"시험 정정",evidence:state.start.bundle.sources[0].evidence,targets:[{reviewId:recordId.parse(review.id),expectedVersion:review.version,question:"정정된 질문",explanation:"정정된 근거",nextAction:"정정된 기준으로 새 답안 확인"}]});
  const resumed=await readSessionResume(db,owner,input.id);check(resumed.state.answers.length===2 && resumed.state.draft.text==="2/5" && resumed.latest?.progress==="완료" && resumed.reviews[0].nextAction==="정정된 기준으로 새 답안 확인","서버 재개 기록 유실");await denied(()=>readSessionResume(db,{realm:"sites",userId:"other"},input.id),"reference_conflict");
  const corrected=await readResultSnapshot(db,owner,input.id);check(corrected.draft.reviews[0].version===2 && corrected.draft.reviews[0].nextAction==="정정된 기준으로 새 답안 확인" && corrected.draft.issues.length>0 && corrected.draft.confirmation?.judgment.unitPassed===true,"정정 후 최신 복습 또는 원본 유실");
  return ["result-computation-commit-evidence-race-rollback","result-different-key-concurrency-single-winner","result-server-resume-answers-draft-latest-correction-and-owner","result-summary-read-only","result-hidden-recall-no-summary-leak","result-two-independent-evidence-pass-delayed-unverified","result-owner-denial","result-seven-batch-failure-full-rollback","result-zero-update-full-rollback","result-stale-evidence-fingerprint-denied","result-concurrent-identical-single-receipt","result-lost-response-replay-no-duplicate","result-key-payload-and-stale-key-conflicts","result-official-progress-performance-review-atomic","result-confirmation-and-target-immutable","result-corrected-review-latest-original-preserved"];
}
async function fetch(request:Request,env:Readonly<{DB:D1Database;BUCKET:R2Bucket}>):Promise<Response> {try{return await runLibrarianFixture(request,env,verify);}catch(error:unknown){if(!(error instanceof Error)) throw error;const causes:string[]=[];let current:unknown=error;while(current instanceof Error){causes.push(current.message);current=current.cause;}return Response.json({causes},{status:500});}}
const worker={fetch};export default worker;
