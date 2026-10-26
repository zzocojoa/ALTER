import { describe,expect,it,vi } from "vitest";
import { classifyExternalFailure } from "../../lib/external/failure.ts";
import { externalDiagnostic,externalExecutionFailure } from "../../lib/external/diagnostic.ts";
import { externalErrorResponse } from "../../lib/external/server-error.ts";
import { siteIdentity } from "../../lib/domain/contracts.ts";

vi.mock("cloudflare:workers",()=>({env:{}}));
vi.mock("../../app/chatgpt-auth",()=>({getChatGPTUser:async()=>null}));
vi.mock("../../db/repositories/external-errors.ts",()=>({readExternalFailureHistory:async()=>({write:null,verify:null,last:null})}));
const id:string="00000000-0000-4000-a000-000000000015";
describe("외부 오류의 민감값 제거",()=>{
  it("중첩 본문·헤더·메시지는 진단과 API 응답에 들어가지 않는다",async()=>{
    const raw=Object.assign(new Error("secret-token private learning text"),{code:"google_rest_failed",method:"docs.documents.get",requestHash:"a".repeat(64),status:429,reason:"quota",retryAfterMs:5000,headers:{Authorization:"secret-token"},body:{student:"private learning text"}});
    const failure=classifyExternalFailure(raw,"verify");
    const diagnostic=externalDiagnostic.parse({event:"external_step_failed",workflowId:id,operationId:id,attemptId:id,leaseEpoch:2,attemptCount:2,state:"unknown",nextAttemptAt:6000,failure});
    const error=externalExecutionFailure(diagnostic,null);
    const response=await externalErrorResponse({} as D1Database,siteIdentity.parse({realm:"sites",userId:"owner"}),error);
    expect(response.status).toBe(429);const body:string=await response.text();expect(body).toContain('"status":429');expect(body).toContain('"reason":"quota"');expect(body).not.toMatch(/secret-token|private learning text|Authorization/);
    expect(JSON.stringify(error)).not.toMatch(/secret-token|private learning text|Authorization/);
  });
  it("알 수 없는 오류와 프로토타입 이름을 허용된 오류 코드로 오인하지 않는다",()=>{
    for(const code of ["constructor","toString","__proto__","secret-token"]) expect(classifyExternalFailure({code,message:"private"},"write")).toMatchObject({code:"external_unclassified_failure",category:"unknown"});
  });
});
