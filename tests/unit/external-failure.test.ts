import { describe, expect, it } from "vitest";
import { classifyExternalFailure } from "../../lib/external/failure.ts";
import { prepareGoogleRestRequest } from "../../lib/google/rest-request.ts";
import { sendGoogleRestAttempt } from "../../lib/google/rest-transport.ts";
import { exchangeGoogleRefresh } from "../../lib/google/oauth-exchange.ts";
import { googleRequestedScopes } from "../../lib/google/permissions.ts";

const now:number=Date.parse("2026-10-25T02:00:00Z");
describe("외부 오류의 조회 우선 분류",()=>{
  it.each([
    [403,"rateLimitExceeded","temporary","verify-after-delay"],
    [403,"insufficientFilePermissions","permission","review-permission"],
    [403,"SERVICE_DISABLED","configuration","review-configuration"],
    [403,"storageQuotaExceeded","storage","review-storage"],
    [401,"authError","authentication","reconnect"],
    [503,"backendError","temporary","verify-after-delay"],
    [400,"unknownProviderReason","unknown","inspect"],
  ])("HTTP %s의 %s를 구분한다",async(status,reason,category,action)=>{
    const request=await prepareGoogleRestRequest({method:"docs.documents.create",title:"시험"},"docs-create");
    let error:unknown=null;
    try{await sendGoogleRestAttempt({fetch:async()=>Response.json({error:{message:"secret-token private-text",errors:[{reason}]}},{status:Number(status)}),now:()=>now,wait:async()=>{},warn:()=>{}},request,"secret-token");}catch(cause:unknown){error=cause;}
    const classified=classifyExternalFailure(error,"write");
    expect(classified).toMatchObject({category,action,status,method:"docs.documents.create",requestHash:request.hash});
    expect(JSON.stringify(classified)).not.toMatch(/secret-token|private-text|unknownProviderReason/);
  });
  it("응답 본문 누락·알 수 없는 오류는 원인 미확인으로 남긴다",()=>{
    expect(classifyExternalFailure(new Error("Bearer token private contents"),"verify")).toMatchObject({category:"unknown",reason:"unclassified-error"});
    expect(classifyExternalFailure({code:"google_rest_failed",status:403},"verify")).toMatchObject({category:"unknown",status:null});
  });
  it("갱신 성공과 invalid_grant·손상 응답을 구분한다",async()=>{
    const runtime={fetch:async()=>Response.json({access_token:"fresh",token_type:"Bearer",expires_in:3600,scope:googleRequestedScopes.join(" ")}),now:()=>now,wait:async()=>{},warn:()=>{}};
    expect((await exchangeGoogleRefresh(runtime,"client","secret","refresh",null)).accessToken).toBe("fresh");
    for(const body of [{error:"invalid_grant"},{unrecognized:"private token"}]) {
      let error:unknown=null;
      try{await exchangeGoogleRefresh({...runtime,fetch:async()=>Response.json(body,{status:400})},"client","secret","refresh",null);}catch(cause:unknown){error=cause;}
      expect(classifyExternalFailure(error,"verify")).toMatchObject({category:"authentication",action:"reconnect",reason:"error" in body?"invalid_grant":"oauth-response-unclassified"});
    }
  });
});
