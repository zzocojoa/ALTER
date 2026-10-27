"use client";
import type { ReactElement } from "react";
import type { LearningType } from "@/lib/reviews/contracts";
import { AnswerInput } from "./answer-input";
import { readReviewAnswers } from "./answer-fields";
export function ReviewFields({type,text,busy,onText,onComposition}:Readonly<{type:LearningType;text:string;busy:boolean;onText:(value:string)=>void;onComposition:(active:boolean)=>void}>):ReactElement {
  const fields=readReviewAnswers(type,text);
  function change(index:number,value:string):void {onText(fields.map((field,i)=>`${field.label}: ${i===index ? value : field.value}`).join("\n"));}
  return <fieldset><legend>자료를 보지 않고 직접 작성</legend>{fields.map((field,index)=><AnswerInput key={field.key} id={`tutor-review-${field.key}`} label={field.label} value={field.value} limit={6000} required={true} describedBy="tutor-draft-status tutor-answer-guidance" busy={busy} onValue={(value):void=>change(index,value)} onComposition={onComposition}/>)}</fieldset>;
}
