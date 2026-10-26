import { z } from "zod";
import { recordId,version,timestamp,studyDate,domainFailure } from "../domain/contracts.ts";

const text=z.string().trim().min(1).max(6000);
export const errorEvidence=z.object({resultVersionId:recordId,resultOrdinal:version,questionId:recordId,answerId:recordId,answerVersion:version,sourceRefIds:z.array(recordId).min(1).max(96),helpIds:z.array(recordId).max(200),concept:text,feedback:text,cause:z.discriminatedUnion("status",[z.object({status:z.literal("unverified")}).strict(),z.object({status:z.literal("documented"),description:text,evidence:text}).strict()])}).strict();
export type ErrorEvidence=Readonly<z.infer<typeof errorEvidence>>;
export const learningType=z.enum(["memory","concept","skill","judgment"]);
export type LearningType=z.infer<typeof learningType>;
export const reviewTask=z.object({type:learningType,criterion:text,originalQuestionId:recordId,originalPrompt:text,prompt:text,sourceRefIds:z.array(recordId).min(1).max(8)}).strict();
export type ReviewTask=Readonly<z.infer<typeof reviewTask>>;
export const reviewSubmission=z.discriminatedUnion("type",[
  z.object({type:z.literal("memory"),recall:text}).strict(),
  z.object({type:z.literal("concept"),example:text,explanation:text}).strict(),
  z.object({type:z.literal("skill"),work:text,output:text}).strict(),
  z.object({type:z.literal("judgment"),case:text,choice:text,reason:text}).strict(),
]);
export type ReviewSubmission=Readonly<z.infer<typeof reviewSubmission>>;
export const reviewConditions=z.object({goalDate:studyDate.nullable(),retentionDays:z.number().int().min(1).max(3650),availableMinutes:z.number().int().min(0).max(1440),requiredMinutes:z.number().int().min(1).max(240)}).strict();
export type ReviewConditions=Readonly<z.infer<typeof reviewConditions>>;
export const confirmedReviewEvidence=z.object({status:z.literal("confirmed"),resultVersionId:recordId,resultOrdinal:version,answerId:recordId,submittedAt:timestamp,confirmedAt:timestamp,correct:z.boolean(),hidden:z.boolean(),helpIds:z.array(recordId).max(200),exposed:z.boolean(),firstAttempt:z.boolean(),evaluation:text}).strict().refine((v)=>v.submittedAt<=v.confirmedAt,{message:"제출 후에 확정한 평가가 필요합니다."});
export type ConfirmedReviewEvidence=Readonly<z.infer<typeof confirmedReviewEvidence>>;
export const intervalStage=z.number().int().min(0).max(4);
export const intervalProposal=z.object({policyVersion:z.literal("seoul-review-v1"),anchorDate:studyDate,stage:intervalStage,baseDays:z.number().int().min(1).max(30),adjustedDays:z.number().int().min(1).max(3650),dueDate:studyDate,conditions:reviewConditions,reasons:z.array(text).min(1),needsTime:z.boolean(),outcome:z.enum(["initial","independent-pass","retry","not-submitted"]),evidence:confirmedReviewEvidence.nullable()}).strict();
export type IntervalProposal=Readonly<z.infer<typeof intervalProposal>>;
export const proposalDecision=z.object({status:z.enum(["proposed","accepted","changed"]),dueDate:studyDate,reason:text,decidedAt:timestamp}).strict();
export const reviewBinding=z.object({reviewId:recordId,reviewVersion:version,planVersion:version,scheduleId:recordId,proposalId:recordId,basisResultVersionId:recordId,baselineAt:timestamp,dueDate:studyDate,kind:z.enum(["variable","delayed-recall"]),task:reviewTask,correctionId:recordId.nullable()}).strict();
export type ReviewBinding=Readonly<z.infer<typeof reviewBinding>>;

/** 질문과 제출 형식을 분리하고 유형 불일치와 이유 없는 판단을 거부합니다. */
export function submissionText(task:ReviewTask,value:ReviewSubmission):string {
  const input=reviewSubmission.parse(value);reviewTask.parse(task);
  if(input.type!==task.type) throw domainFailure("validation","review.submission-type",null);
  switch(input.type){
    case "memory":return `기억에서 꺼낸 답: ${input.recall}`;
    case "concept":return `새 예시: ${input.example}\n자신의 설명: ${input.explanation}`;
    case "skill":return `직접 수행한 작업: ${input.work}\n작업 결과: ${input.output}`;
    case "judgment":return `새 사례: ${input.case}\n선택: ${input.choice}\n선택 이유: ${input.reason}`;
  }
}
const prompts:Readonly<Record<LearningType,string>>={memory:"자료를 가리고 기억에서 답을 꺼내세요.",concept:"원문제와 다른 새 예시를 직접 만들고 개념을 자신의 말로 설명하세요.",skill:"원문제와 조건이 다른 작은 작업을 직접 수행하고 수행 과정과 결과를 제출하세요.",judgment:"원문제와 다른 새 사례를 제시하고 선택과 그 이유를 설명하세요."};
export function makeReviewTask(type:LearningType,criterion:string,questionId:string,originalPrompt:string,sourceRefIds:readonly string[]):ReviewTask {
  return reviewTask.parse({type,criterion,originalQuestionId:questionId,originalPrompt,prompt:`${prompts[type]}\n확인 기준: ${criterion}`,sourceRefIds});
}
