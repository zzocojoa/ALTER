import type { TutorAnswer } from "./contracts.ts";
export function normalizedPerformanceText(value:string):string {return value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/[^\p{L}\p{N}]/gu,"");}
/** 문장부호·공백 또는 파일 식별자만 바꾼 재제출을 새 수행으로 세지 않습니다. */
export function repeatsPreviousAnswer(answer:TutorAnswer,previous:readonly TutorAnswer[]):boolean {
  return previous.some((old):boolean=>old.questionId!==answer.questionId && (answer.contentFingerprint!==undefined && old.contentFingerprint===answer.contentFingerprint || answer.text.trim().length>0 && old.text.trim().length>0 && normalizedPerformanceText(answer.text)===normalizedPerformanceText(old.text) || answer.text.trim().length===0 && old.text.trim().length===0 && answer.fileIds.length>0 && JSON.stringify([...answer.fileIds].sort())===JSON.stringify([...old.fileIds].sort())));
}
