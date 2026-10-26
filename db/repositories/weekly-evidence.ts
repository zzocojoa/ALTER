import { z } from "zod";
import { contentHash,domainFailure,recordId,version,timestamp } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import { tutorState } from "../../lib/tutor/contracts.ts";
import { resultJudgment } from "../../lib/results/contracts.ts";
import { weekContaining } from "../../lib/weekly/period.ts";
import { aggregateWeeklyEvidence,weeklyAnswerRow,weeklyCorrectionRow,weeklyReviewRow } from "../../lib/weekly/evidence.ts";
import type { WeeklyAggregate,WeeklySession } from "../../lib/weekly/evidence.ts";
import { readStorage,requireInBatch } from "./atomic.ts";
import type { SqlValue } from "./atomic.ts";

const confirmationRow=z.object({sessionId:recordId,resultVersionId:recordId,resultOrdinal:version,sessionVersion:version,confirmedAt:timestamp,state:z.string().nullable(),judgment:z.string()}).strict();
const storedAnswer=weeklyAnswerRow.omit({helpIds:true}).extend({helpIds:z.string()}).strict();
type WeeklyReadQuery=Readonly<{sql:string;values:readonly SqlValue[];fields:readonly string[]}>;
export type WeeklyEvidenceSnapshot=Readonly<{aggregate:WeeklyAggregate;sessions:readonly WeeklySession[];revision:string;guards:readonly Readonly<{query:WeeklyReadQuery;rows:string}>[]}>;
/** 한 읽기 배치에서 확정 사건·실제 답안·현재 도움과 정정을 함께 읽습니다. 숨긴 인출 중에는 답안을 내보내지 않습니다. */
export async function readWeeklyEvidence(db:D1Database,owner:SiteIdentity,courseId:string,date:string):Promise<WeeklyEvidenceSnapshot> {
  recordId.parse(courseId);const period=weekContaining(date);
  const queries:readonly WeeklyReadQuery[]=[
    {sql:"SELECT id FROM courses WHERE owner_id=? AND id=?",values:[owner.userId,courseId],fields:["id"]},
    {sql:"SELECT COUNT(*) AS n FROM attempts WHERE owner_id=? AND status='awaiting-answer' AND hidden_material=1",values:[owner.userId],fields:["n"]},
    {sql:"SELECT c.session_id AS sessionId,c.result_version_id AS resultVersionId,r.ordinal AS resultOrdinal,c.session_version AS sessionVersion,c.confirmed_at AS confirmedAt,json_extract(e.content,'$.state') AS state,c.judgment FROM session_confirmations c JOIN confirmed_results r ON r.owner_id=c.owner_id AND r.id=c.result_version_id JOIN sessions s ON s.owner_id=c.owner_id AND s.id=c.session_id JOIN units u ON u.owner_id=s.owner_id AND u.id=s.unit_id LEFT JOIN tutor_events e ON e.owner_id=c.owner_id AND e.session_id=c.session_id AND e.version=c.session_version+1 WHERE c.owner_id=? AND u.course_id=? AND c.confirmed_at>=? AND c.confirmed_at<? ORDER BY c.confirmed_at,c.session_id LIMIT 201",values:[owner.userId,courseId,period.startAt,period.endAt],fields:["sessionId", "resultVersionId", "resultOrdinal", "sessionVersion", "confirmedAt", "state", "judgment"]},
    {sql:"SELECT a.id,t.session_id AS sessionId,t.question_id AS questionId,t.id AS attemptId,a.ordinal AS version,a.text,a.submitted_at AS submittedAt,t.hidden_material AS hidden,t.mode,t.status,(SELECT json_group_array(h.id) FROM help_events h JOIN attempts p ON p.owner_id=h.owner_id AND p.id=h.attempt_id WHERE p.owner_id=t.owner_id AND p.question_id=t.question_id ORDER BY h.id) AS helpIds FROM answers a JOIN attempts t ON t.owner_id=a.owner_id AND t.id=a.attempt_id JOIN session_confirmations c ON c.owner_id=t.owner_id AND c.session_id=t.session_id JOIN sessions s ON s.owner_id=t.owner_id AND s.id=t.session_id JOIN units u ON u.owner_id=s.owner_id AND u.id=s.unit_id WHERE a.owner_id=? AND u.course_id=? AND c.confirmed_at>=? AND c.confirmed_at<? ORDER BY a.submitted_at,a.id LIMIT 2001",values:[owner.userId,courseId,period.startAt,period.endAt],fields:["id", "sessionId", "questionId", "attemptId", "version", "text", "submittedAt", "hidden", "mode", "status", "helpIds"]},
    {sql:"SELECT r.id,e.unit_id AS unitId,r.version,e.id AS errorId,e.answer_id AS answerId,e.concept,r.question,r.explanation,r.next_action AS nextAction,r.correction_id AS correctionId,r.recheck_state AS recheckState FROM review_items r JOIN errors e ON e.owner_id=r.owner_id AND e.id=r.error_id JOIN units u ON u.owner_id=e.owner_id AND u.id=e.unit_id WHERE r.owner_id=? AND u.course_id=? ORDER BY r.id LIMIT 201",values:[owner.userId,courseId],fields:["id", "unitId", "version", "errorId", "answerId", "concept", "question", "explanation", "nextAction", "correctionId", "recheckState"]},
    {sql:"SELECT c.id,c.error_id AS errorId,e.unit_id AS unitId,c.answer_id AS answerId,c.created_at AS createdAt,c.reason,c.evidence FROM corrections c JOIN errors e ON e.owner_id=c.owner_id AND e.id=c.error_id JOIN units u ON u.owner_id=e.owner_id AND u.id=e.unit_id WHERE c.owner_id=? AND u.course_id=? ORDER BY c.created_at,c.id LIMIT 201",values:[owner.userId,courseId],fields:["id", "errorId", "unitId", "answerId", "createdAt", "reason", "evidence"]},
];
  const rows=await readStorage("weekly.evidence-snapshot",()=>db.batch(queries.map(query=>db.prepare(query.sql).bind(...query.values))));
  if(rows.some(row=>!row.success)) throw domainFailure("storage_failure","weekly.evidence-batch",null);
  if(rows[0].results.length!==1) throw domainFailure("reference_conflict","weekly.owner-course",{courseId});
  if(z.object({n:z.number().int().nonnegative()}).parse(rows[1].results[0]).n>0) throw domainFailure("reference_conflict","weekly.hidden-recall-active",null);
  if(rows[2].results.length>200 || rows[3].results.length>2000 || rows[4].results.length>200 || rows[5].results.length>200) throw domainFailure("limit_exceeded","weekly.evidence-range-too-large",{courseId,period:period.start});
  const sessions=rows[2].results.map((raw):WeeklySession=>{const row=confirmationRow.parse(raw);if(row.state===null) throw domainFailure("reference_conflict","weekly.confirmation-event-missing",{sessionId:row.sessionId,resultVersionId:row.resultVersionId});return {...row,state:tutorState.parse(JSON.parse(row.state)),judgment:resultJudgment.parse(JSON.parse(row.judgment))};});
  const answers=rows[3].results.map(raw=>{const row=storedAnswer.parse(raw);return weeklyAnswerRow.parse({...row,helpIds:JSON.parse(row.helpIds)});});
  const reviews=rows[4].results.map(raw=>weeklyReviewRow.parse(raw));const corrections=rows[5].results.map(raw=>weeklyCorrectionRow.parse(raw));
  const aggregate=await aggregateWeeklyEvidence({courseId,period,sessions,answers,reviews,corrections});
  return {aggregate,sessions,revision:await contentHash(rows.map(row=>row.results)),guards:queries.map((query,index)=>({query,rows:JSON.stringify(rows[index].results)}))};
}

/** 같은 순서의 실제 조회 결과를 배치 안에서 비교해 추가 답안·도움·정정 경쟁도 차단합니다. */
export function weeklyEvidenceGuards(db:D1Database,owner:SiteIdentity,snapshot:WeeklyEvidenceSnapshot,requestId:string,startStep:number):readonly D1PreparedStatement[] {
  return snapshot.guards.map(({query,rows},index)=>requireInBatch(db,owner.userId,requestId,startStep+index,`(SELECT json_group_array(json_object(${query.fields.flatMap(field=>[`'${field}'`,field]).join(",")})) FROM (${query.sql}))=?`,[...query.values,rows]));
}
