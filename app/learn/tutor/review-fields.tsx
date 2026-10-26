"use client";
import type { ReactElement } from "react";
import type { LearningType } from "@/lib/reviews/contracts";
import { reviewFields } from "@/lib/reviews/submission";
export function ReviewFields({type,text,busy,onText}:Readonly<{type:LearningType;text:string;busy:boolean;onText:(value:string)=>void}>):ReactElement {
  const fields=reviewFields[type];const values=fields.map((field,index):string=>{const prefix=`${field.label}: `;const from=text.indexOf(prefix);const next=fields[index+1];const to=next ? text.indexOf(`\n${next.label}: `) : text.length;return from<0 ? "" : text.slice(from+prefix.length,to<0 ? text.length : to);});
  function change(index:number,value:string):void {onText(fields.map((field,i)=>`${field.label}: ${i===index ? value : values[i]}`).join("\n"));}
  return <fieldset><legend>자료를 보지 않고 직접 작성</legend>{fields.map((field,index)=><label key={field.key}>{field.label}<textarea value={values[index]} required maxLength={6000} rows={4} disabled={busy} onChange={(event):void=>change(index,event.target.value)}/></label>)}</fieldset>;
}
