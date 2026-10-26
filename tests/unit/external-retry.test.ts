import { describe, expect, it } from "vitest";
import { planExternalRetry } from "../../lib/external/retry.ts";
import { googleRetryAfter } from "../../lib/google/rest-transport.ts";
const now:number=Date.parse("2026-10-25T02:00:00Z");
describe("영속 재시도 일정",()=>{
  it("Retry-After 초·HTTP 날짜와 잘못된 값을 구분한다",()=>{
    expect(googleRetryAfter("120",now)).toBe(120_000);
    expect(googleRetryAfter(new Date(now+120_000).toUTCString(),now)).toBe(120_000);
    for(const value of [null,"nonsense","-5","99999999999999999999",new Date(now-1000).toUTCString()]) expect(googleRetryAfter(value,now)).toBeNull();
  });
  it("서버 지시와 지수 백오프·지터 중 더 늦은 시각을 사용한다",()=>{
    expect(planExternalRetry({attemptCount:3,now,deadlineAt:now+86_400_000,retryAfterMs:20_000,jitter:0.5})).toEqual({status:"scheduled",nextAttemptAt:now+20_000});
    expect(planExternalRetry({attemptCount:3,now,deadlineAt:now+86_400_000,retryAfterMs:1000,jitter:0.5})).toEqual({status:"scheduled",nextAttemptAt:now+4500});
  });
  it("시도 횟수·전체 기한을 넘기면 더 이상 자동 조회를 예약하지 않는다",()=>{
    expect(planExternalRetry({attemptCount:8,now,deadlineAt:now+86_400_000,retryAfterMs:null,jitter:0})).toEqual({status:"exhausted",reason:"attempt-limit"});
    expect(planExternalRetry({attemptCount:1,now,deadlineAt:now+500,retryAfterMs:null,jitter:0})).toEqual({status:"exhausted",reason:"deadline"});
    expect(planExternalRetry({attemptCount:1,now,deadlineAt:now+5000,retryAfterMs:Number.MAX_SAFE_INTEGER,jitter:0})).toEqual({status:"exhausted",reason:"deadline"});
    expect(()=>planExternalRetry({attemptCount:1,now,deadlineAt:now+5000,retryAfterMs:null,jitter:2})).toThrow();
  });
});
