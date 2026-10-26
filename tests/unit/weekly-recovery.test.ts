import { describe,expect,it } from "vitest";
import { weeklyRecoveryDecision } from "../../lib/weekly/recovery";
import type { WeeklyAttemptStatus } from "../../lib/weekly/recovery";
import { weeklyWorkspace } from "../../lib/weekly/workspace";
import type { WeeklyWorkspace } from "../../lib/weekly/workspace";
import { weeklyPlanFixture } from "../fixtures/weekly-plan";
import { tutorId } from "../fixtures/tutor-state";

const invalid:WeeklyAttemptStatus={stage:"invalid",reservationState:"settled",outstandingReservedUnits:0,responseId:"resp_weekly_invalid"};
async function pending():Promise<WeeklyWorkspace> {const {context}=await weeklyPlanFixture();return weeklyWorkspace.parse({id:tutorId(1397),version:2,courseId:context.units[0].courseId,date:context.aggregate.period.start,context,fingerprint:"a".repeat(64),phase:"generating",proposal:null,claims:[],notes:"직접 쓴 메모",pendingKey:"weekly-fixture",confirmedVersionId:null});}

describe("주간 생성의 명시적 회복 조건",()=>{
  it("예약 전 중단과 비용 확정된 검증 실패만 다시 연다",async()=>{const state=await pending();expect(weeklyRecoveryDecision(state,true,[]).allowed).toBe(true);expect(weeklyRecoveryDecision(state,true,[invalid]).allowed).toBe(true);expect(weeklyRecoveryDecision(state,true,[{...invalid,reservationState:"released"}]).allowed).toBe(true);expect(weeklyRecoveryDecision({...state,phase:"draft",pendingKey:null},true,[]).allowed).toBe(false);});
  it("진행 중·결과 불명·잔여 예약이 하나라도 있으면 회복을 막는다",async()=>{const state=await pending();for(const status of [{...invalid,reservationState:"reserved" as const},{...invalid,reservationState:"unknown" as const},{...invalid,outstandingReservedUnits:1},{...invalid,stage:"unknown" as const},{...invalid,stage:null}]) expect(weeklyRecoveryDecision(state,false,[invalid,status]).allowed).toBe(false);});
  it("근거가 바뀐 뒤 확정된 응답만 버리고 현재 근거로 다시 연다",async()=>{const state=await pending();for(const stage of ["settled","validated"] as const){const status={...invalid,stage};expect(weeklyRecoveryDecision(state,true,[status]).allowed).toBe(false);expect(weeklyRecoveryDecision(state,false,[status]).allowed).toBe(true);expect(weeklyRecoveryDecision(state,false,[{...status,responseId:null}]).allowed).toBe(false);}expect(state.notes).toBe("직접 쓴 메모");});
});
