import { domainFailure } from "../domain/contracts.ts";
import { normalizedPerformanceText } from "../tutor/identity.ts";
import { reviewSubmission } from "./contracts.ts";
import type { ReviewTask,ReviewSubmission,LearningType } from "./contracts.ts";

export type SubmissionField=Readonly<{key:string;label:string}>;
export const reviewFields:Readonly<Record<LearningType,readonly SubmissionField[]>>={memory:[{key:"recall",label:"기억에서 꺼낸 답"}],concept:[{key:"example",label:"새 예시"},{key:"explanation",label:"자신의 설명"}],skill:[{key:"work",label:"직접 수행한 작업"},{key:"output",label:"작업 결과"}],judgment:[{key:"case",label:"새 사례"},{key:"choice",label:"선택"},{key:"reason",label:"선택 이유"}]};
/** 초안은 빈 입력을 허용하지만 제출은 유형별 필수 필드를 모두 검사합니다. */
export function parseReviewSubmission(task:ReviewTask,text:string):ReviewSubmission {
  const fields=reviewFields[task.type];const values:Record<string,string>={};
  for(const [index,field] of fields.entries()) {
    const start=`${field.label}: `;const next=fields[index+1];const from=text.indexOf(start);const to=next ? text.indexOf(`\n${next.label}: `) : text.length;
    if(from<0 || to<from || index===0 && from!==0) throw domainFailure("validation","review.required-submission-fields",null);
    values[field.key]=text.slice(from+start.length,to).trim();
  }
  const input=reviewSubmission.parse({type:task.type,...values});
  const condition=input.type==="concept" ? input.example : input.type==="judgment" ? input.case : input.type==="skill" ? input.work : null;
  if(condition && normalizedPerformanceText(condition)===normalizedPerformanceText(task.originalPrompt)) throw domainFailure("validation","review.fresh-condition-required",null);
  return input;
}
