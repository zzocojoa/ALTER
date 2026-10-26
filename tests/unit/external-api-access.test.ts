import { beforeEach,describe,expect,it,vi } from "vitest";
import { GET,POST } from "../../app/api/external/route";

const fixture=vi.hoisted(()=>({identity:vi.fn(),resume:vi.fn(),view:vi.fn(),settings:vi.fn()}));
vi.mock("../../db/repositories/restore-execution", () => ({ readRestoredExecution: vi.fn().mockResolvedValue(null) }));
vi.mock("cloudflare:workers",()=>({env:{ALTER_OWNER_USER_ID:"owner-test",ALTER_SITE_ORIGIN:"https://alter.test",DB:{}}}));
vi.mock("../../app/chatgpt-auth",()=>({getChatGPTUser:fixture.identity}));
vi.mock("../../lib/external/resume",()=>({resumeExternalWorkflow:fixture.resume,readExternalWorkflowView:fixture.view}));
vi.mock("../../lib/google/server",()=>({googleApiServerSettings:fixture.settings,googleExecutionRuntime:()=>({})}));
beforeEach(()=>{vi.clearAllMocks();});
function request(origin:string|null,body:unknown):Request {const headers=new Headers({"content-type":"application/json"});if(origin!==null) headers.set("origin",origin);return new Request("https://alter.test/api/external",{method:"POST",headers,body:JSON.stringify(body)});}
describe("외부 작업 재개 API 접근 경계",()=>{
  it.each([{identity:null,status:401},{identity:{userId:"other",email:"other@example.test"},status:403}])("비소유자에게 조회·재개를 허용하지 않는다",async({identity,status})=>{
    fixture.identity.mockResolvedValue(identity);
    expect((await GET(new Request("https://alter.test/api/external?id=unknown"))).status).toBe(status);
    expect((await POST(request("https://alter.test",{}))).status).toBe(status);
    expect(fixture.resume).not.toHaveBeenCalled();expect(fixture.view).not.toHaveBeenCalled();expect(fixture.settings).not.toHaveBeenCalled();
  });
  it.each([null,"https://other.test"])("출처가 다르면 소유자의 재개도 거부한다",async origin=>{
    fixture.identity.mockResolvedValue({userId:"owner-test",email:"owner@example.test"});
    expect((await POST(request(origin,{}))).status).toBe(403);expect(fixture.resume).not.toHaveBeenCalled();
  });
  it("임의 요청 스냅샷·서비스 URL을 받아 실행하지 않는다",async()=>{
    fixture.identity.mockResolvedValue({userId:"owner-test",email:"owner@example.test"});
    expect((await POST(request("https://alter.test",{id:"00000000-0000-4000-a000-000000000015",url:"https://other.test",snapshot:{secret:"private"}}))).status).toBe(400);
    expect(fixture.settings).not.toHaveBeenCalled();expect(fixture.resume).not.toHaveBeenCalled();
  });
});
