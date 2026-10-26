import { z } from "zod";
import { materialFailure,materialPolicy } from "../materials/policy.ts";

const object=z.record(z.unknown());
const elements=z.array(z.unknown()).max(10000);
function unsupported(field:string):never {throw materialFailure("material_content_invalid",`google-docs-unsupported:${field}`,422);}
function requireSupportedContent(value:Readonly<Record<string,unknown>>):void {
  for(const [key,entry] of Object.entries(value))if((key.startsWith("suggested") || ["inlineObjects","positionedObjects","footnotes","headers","footers"].includes(key)) && entry!==undefined && Object.keys(object.parse(entry)).length>0)unsupported(key);
}
function paragraphText(value:unknown):string {
  const paragraph=object.parse(value);requireSupportedContent(paragraph);
  if(paragraph.positionedObjectIds!==undefined && z.array(z.string()).parse(paragraph.positionedObjectIds).length>0)unsupported("positionedObjectIds");
  return elements.parse(paragraph.elements).map((raw):string=>{const run=object.parse(raw);
    if(Object.keys(run).some(key=>key.startsWith("suggested")))unsupported("suggested-edit");
    const types=Object.keys(run).filter(key=>!["startIndex","endIndex"].includes(key));
    if(types.length!==1 || types[0]!=="textRun")unsupported(types.join(","));
    return z.object({content:z.string(),textStyle:z.unknown().optional()}).strict().parse(run.textRun).content;
  }).join("");
}
function bodyText(value:unknown,depth:number):string {
  if(depth>10)unsupported("table-depth");
  return elements.parse(value).map((raw):string=>{const item=object.parse(raw);requireSupportedContent(item);
    const types=Object.keys(item).filter(key=>!["startIndex","endIndex"].includes(key));
    if(types.length!==1)unsupported("structural-element");
    if(types[0]==="sectionBreak")return "";
    if(types[0]==="paragraph")return paragraphText(item.paragraph);
    if(types[0]==="table")return z.object({tableRows:elements}).parse(item.table).tableRows.map((row):string=>z.object({tableCells:elements}).parse(row).tableCells.map((cell):string=>bodyText(z.object({content:elements}).parse(cell).content,depth+1).trimEnd()).join("\t")).join("\n")+"\n";
    return unsupported(types[0]);
  }).join("");
}
function tabText(value:unknown,depth:number):string {
  if(depth>10)unsupported("tab-depth");const tab=z.object({tabProperties:z.object({title:z.string(),tabId:z.string()}),documentTab:object,childTabs:elements.optional()}).parse(value);
  requireSupportedContent(tab.documentTab);
  const body=z.object({content:elements}).parse(tab.documentTab.body);
  return `【${tab.tabProperties.title}】\n${bodyText(body.content,0)}${(tab.childTabs??[]).map(child=>tabText(child,depth+1)).join("\n")}`;
}
/** 문서 구조를 읽어 탭·표의 경계를 보존하며 지원하지 않는 콘텐츠를 조용히 누락하지 않습니다. */
export function readGoogleReferenceDocument(value:unknown,fileId:string):Readonly<{text:string;revision:string}> {
  const document=z.object({documentId:z.literal(fileId),revisionId:z.string().min(1),tabs:elements.min(1)}).passthrough().parse(value);requireSupportedContent(document);
  const text:string=document.tabs.map(tab=>tabText(tab,0)).join("\n");const bytes:number=new TextEncoder().encode(text).byteLength;
  if(bytes<1 || bytes>materialPolicy.types.text.maximumBytes)throw materialFailure("material_size_exceeded","google-docs-text",413);
  return {text,revision:document.revisionId};
}
