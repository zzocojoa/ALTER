import path from "node:path";
import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import { confirmedPlanFixtureWithId } from "../tests/fixtures/confirmed-plan.ts";
import { ADVISOR_ACCEPTANCE_ID } from "../lib/advisor/acceptance.ts";
import { getAdvisor } from "../db/repositories/advisor.ts";

/** 로컬 미리보기의 고정 모의 사용자에게만 무과금 계획을 준비합니다. 운영 바인딩은 받지 않습니다. */
const runtime = new Miniflare({ modules: true,script: "export default {fetch(){return new Response('local-only')}}",compatibilityDate: "2026-05-15",d1Databases: { DB: "00000000-0000-4000-8000-000000000000" },d1Persist: path.join(process.env.ALTER_BROWSER_STATE_DIRECTORY ?? ".wrangler/state","v3/d1"),cf: false });
try {
  const db = await runtime.getD1Database("DB") as unknown as D1Database;
  const tables = await db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='study_scopes'").first<number>("n");
  assert.equal(tables,1,"먼저 npm run db:preview로 로컬 마이그레이션을 적용해 주세요.");
  const owner = { realm: "sites" as const,userId: "local_seedy" };
  const exists = await db.prepare("SELECT COUNT(*) AS n FROM advisor_sessions WHERE owner_id=? AND id=?").bind(owner.userId,ADVISOR_ACCEPTANCE_ID).first<number>("n");
  if (exists === 0) await confirmedPlanFixtureWithId(db,owner,ADVISOR_ACCEPTANCE_ID);
  assert.equal((await getAdvisor(db,owner,ADVISOR_ACCEPTANCE_ID)).phase,"confirmed");
  console.log(JSON.stringify({ status: "passed",environment: "local-preview-mock-plan",actualAiCalls: 0 }));
} finally { await runtime.dispose(); }
