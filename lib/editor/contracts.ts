import { z } from "zod";
import { recordId,timestamp,version } from "../domain/contracts.ts";

export const editorVersion=z.object({id:recordId,parentId:recordId.nullable(),feedbackId:recordId.nullable(),answerId:recordId,attemptId:recordId,text:z.string().max(60000),fileIds:z.array(recordId).max(4),reason:z.string().trim().min(1).max(4000).nullable(),planVersionId:recordId,unitVersion:version,createdAt:timestamp}).strict();
export type EditorVersion=Readonly<z.infer<typeof editorVersion>>;
export const editorCitation=z.object({sourceRefId:recordId,quote:z.string().min(1).max(2000)}).strict();
export const editorLocation=z.discriminatedUnion("kind",[
  z.object({kind:z.literal("text"),start:z.number().int().nonnegative(),end:z.number().int().positive(),quote:z.string().min(1).max(2000)}).strict(),
  z.object({kind:z.literal("image"),fileId:recordId,left:z.number().min(0).max(1),top:z.number().min(0).max(1),right:z.number().min(0).max(1),bottom:z.number().min(0).max(1)}).strict(),
]);
export const editorBasis=z.object({location:editorLocation,criterion:z.enum(["self-explanation","new-condition"]),criterionQuote:z.string().min(1).max(2000)}).strict();
export const editorIssue=z.object({basisIndex:z.number().int().min(0).max(3),issue:z.enum(["definition","reasoning","condition","calculation","readability"]),direction:z.enum(["check-definition","explain-reason","compare-condition","check-calculation","clarify-writing"]),citations:z.array(editorCitation).min(1).max(4)}).strict();
/** 자유 서술형 대체 답안을 받지 않고 실제 초안 구간과 수정 방향만 받습니다. */
export const editorFeedbackOutput=z.object({kind:z.literal("editor-draft-feedback"),versionId:recordId,answerId:recordId,verdict:z.enum(["issues-found","no-issue-evidenced"]),basis:z.array(editorBasis).min(1).max(4),items:z.array(editorIssue).max(2)}).strict();
export type EditorFeedbackOutput=Readonly<z.infer<typeof editorFeedbackOutput>>;
export const editorFeedbackRecord=z.object({id:recordId,helpEventId:recordId,helpAttemptId:recordId,itemIds:z.array(recordId).max(2),output:editorFeedbackOutput,committedAt:timestamp}).strict();
export type EditorFeedbackRecord=Readonly<z.infer<typeof editorFeedbackRecord>>;
export const editorReviewOutput=z.object({kind:z.literal("editor-revision-review"),versionId:recordId,answerId:recordId,feedbackId:recordId,outcome:z.enum(["needs-revision","ready-for-recheck"]),checks:z.array(z.object({itemId:recordId,resolved:z.boolean(),revisionLocation:editorLocation,reasonQuote:z.string().min(1).max(2000)}).strict()).min(1).max(2),remaining:editorFeedbackOutput}).strict();
export type EditorReviewOutput=Readonly<z.infer<typeof editorReviewOutput>>;
export const editorReviewRecord=z.object({id:recordId,output:editorReviewOutput,committedAt:timestamp}).strict();
export type EditorReviewRecord=Readonly<z.infer<typeof editorReviewRecord>>;
export const editorState=z.object({phase:z.enum(["draft","draft-saved","awaiting-revision","revision-saved","ready-for-recheck","variation"]),versions:z.array(editorVersion).max(40),currentVersionId:recordId.nullable(),draftReason:z.string().max(4000),feedbacks:z.array(editorFeedbackRecord).max(40),reviews:z.array(editorReviewRecord).max(40)}).strict();
export type EditorState=Readonly<z.infer<typeof editorState>>;
