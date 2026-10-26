import { describe,it,expect } from "vitest";
import { googleReferenceMetadata,googleReferenceFormat,requireUnchangedGoogleReference } from "../../lib/google-reference/contract";
import { readGoogleReferenceDocument } from "../../lib/google-reference/document";

const metadata={id:"chosen",name:"참고",mimeType:"image/jpeg",version:"1",modifiedTime:"2026-10-25T00:00:00Z",trashed:false,isAppAuthorized:true,capabilities:{canEdit:false,canDownload:true}};
const paragraph=(text:string):Readonly<{paragraph:Readonly<{elements:readonly unknown[]}>}>=>( {paragraph:{elements:[{textRun:{content:text}}]}} );
const tab=(id:string,text:string):Readonly<Record<string,unknown>>=>({tabProperties:{tabId:id,title:id},documentTab:{body:{content:[paragraph(text)]}}});
describe("Google 참고 사본",()=>{
  it("JPEG는 8MiB 한도를 적용하고 모르는 크기는 스트림에서 검사한다",()=>{expect(googleReferenceFormat(googleReferenceMetadata.parse(metadata))).toMatchObject({kind:"image",mime:"image/jpeg",expectedBytes:null,maximumBytes:8388608});expect(()=>googleReferenceFormat(googleReferenceMetadata.parse({...metadata,size:"8388609"}))).toThrow();expect(()=>googleReferenceMetadata.parse({...metadata,capabilities:{canEdit:true,canDownload:false}})).toThrow();});
  it("권한·제목·버전·변경 시각·유형 변경을 누락하지 않는다",()=>{const before=googleReferenceMetadata.parse(metadata);for(const change of [{version:"2"},{name:"다른 제목"},{modifiedTime:"2026-10-25T01:00:00Z"},{mimeType:"image/png"},{trashed:true},{isAppAuthorized:false},{size:"100"}])expect(()=>requireUnchangedGoogleReference(before,googleReferenceMetadata.parse({...metadata,...change}))).toThrow();});
  it("여러 탭과 자식 탭의 본문을 모두 보존한다",()=>{const document={documentId:"chosen",revisionId:"r1",tabs:[{...tab("첫째","첫 본문\n"),childTabs:[tab("자식","하위 내용\n")]},tab("둘째","다음 본문\n")]};const result=readGoogleReferenceDocument(document,"chosen");expect(result.text).toContain("첫 본문");expect(result.text).toContain("하위 내용");expect(result.text).toContain("다음 본문");expect(()=>readGoogleReferenceDocument(document,"forged")).toThrow();});
  it("수식·이미지·각주와 변경 제안을 빈 텍스트로 생략하지 않는다",()=>{for(const content of [{equation:{}},{inlineObjectElement:{inlineObjectId:"x"}},{footnoteReference:{footnoteId:"n"}},{textRun:{content:"x"},suggestedInsertionIds:["s"]}])expect(()=>readGoogleReferenceDocument({documentId:"chosen",revisionId:"r1",tabs:[{...tab("첫째",""),documentTab:{body:{content:[{paragraph:{elements:[content]}}]}}}]},"chosen")).toThrow();});
});
