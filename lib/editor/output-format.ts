import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import type { AutoParseableTextFormat } from "openai/lib/parser";
import { editorBasis,editorFeedbackOutput,editorLocation,editorReviewOutput } from "./contracts.ts";
import type { EditorFeedbackOutput,EditorReviewOutput } from "./contracts.ts";

type TextLocation=Readonly<{kind:"text";start:number;end:number;quote:string}>;
/** 모델이 문자 수를 계산하지 않고 서버가 만든 정확한 구간을 선택하게 합니다. */
export function editorDraftLocations(text:string):readonly TextLocation[] {
  const characters:readonly string[]=Array.from(text);
  return Array.from({length:Math.ceil(characters.length/200)},(_value,index):TextLocation=>({kind:"text",start:index*200,end:Math.min((index+1)*200,characters.length),quote:characters.slice(index*200,(index+1)*200).join("")}));
}
function draftLocationSchema(text:string):z.ZodType<z.output<typeof editorLocation>,z.ZodTypeDef,z.input<typeof editorLocation>> {
  const choices=editorDraftLocations(text).map(place=>z.object({kind:z.literal("text"),start:z.literal(place.start),end:z.literal(place.end),quote:z.literal(place.quote)}).strict());
  const image=editorLocation.options[1];
  return choices.length===0 ? image : z.union([choices[0],image,...choices.slice(1)]);
}
export function editorFeedbackTextFormat(text:string):AutoParseableTextFormat<{result:EditorFeedbackOutput}> {
  const location=draftLocationSchema(text);
  const feedback=editorFeedbackOutput.extend({basis:z.array(editorBasis.extend({location})).min(1).max(4)});
  return zodTextFormat(z.object({result:feedback}).strict(),"alter_editor_feedback");
}
export function editorRevisionTextFormat(text:string):AutoParseableTextFormat<{result:EditorReviewOutput}> {
  const location=draftLocationSchema(text);
  const feedback=editorFeedbackOutput.extend({basis:z.array(editorBasis.extend({location})).min(1).max(4)});
  const check=editorReviewOutput.shape.checks.element.extend({revisionLocation:location});
  const review=editorReviewOutput.extend({checks:z.array(check).min(1).max(2),remaining:feedback});
  return zodTextFormat(z.object({result:review}).strict(),"alter_editor_review");
}
