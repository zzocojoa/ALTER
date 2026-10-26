import { requireCurrentExecutionAuthority } from "../../db/repositories/restore-execution.ts";
import { recordExternalGoogleRequest } from "../../db/repositories/external-google-request.ts";
import type { ExternalGoogleContext } from "../../db/repositories/external-google-request.ts";
import { verifyGoogleFile } from "./resources.ts";
import { readGoogleResource,registerGoogleCreatedResource } from "../../db/repositories/google-resources.ts";
import { markGoogleProviderReconsent, recordGoogleProviderBlock, requireGoogleProviderAvailable } from "../../db/repositories/google-observations.ts";
import { recordId } from "../domain/contracts.ts";
import type { SiteIdentity } from "../domain/contracts.ts";
import { requireGoogleAccessToken } from "./access-token.ts";
import type { GoogleCredentialSettings } from "./access-token.ts";
import { googleFailure } from "./errors.ts";
import { prepareGoogleQuota,boundGoogleResponseQuota } from "./quota.ts";
import type { GoogleQuotaPolicy } from "./quota.ts";
import { googleStorageEvidence } from "./project.ts";
import type { GoogleProjectEvidence, GoogleStorageEvidence } from "./project.ts";
import { requireGoogleResourceGrant } from "./permissions.ts";
import type { GoogleResourceRole } from "./permissions.ts";
import type { GooglePickerSelection } from "./picker.ts";
import { prepareGoogleRestRequest } from "./rest-request.ts";
import type { GoogleRestInput } from "./rest-request.ts";
import { googleRestRetryDelay, sendGoogleRestAttempt } from "./rest-transport.ts";
import type { GoogleRestFailure, GoogleRestResult, GoogleRestRuntime } from "./rest-transport.ts";
import type { GoogleOAuthRuntime } from "./oauth-exchange.ts";
import { authorizeGoogleRestResource } from "./resource-access.ts";
import { beginGoogleRequest, finishGoogleRequest, installGoogleQuotaPolicy, reserveGoogleRequest, reserveGoogleStorageProbe } from "../../db/repositories/google-quota.ts";
import type { ManagedGoogleConnection } from "../../db/repositories/google-managed.ts";
import type { GoogleRestRequest } from "./rest-request.ts";
import type { GoogleQuotaPlan } from "./quota.ts";
import { readManagedGoogleConnection } from "../../db/repositories/google-managed.ts";

export type GoogleExecutionSettings = Readonly<{ credentials: GoogleCredentialSettings; project: GoogleProjectEvidence; quota: GoogleQuotaPolicy }>;
export type GoogleExecutionRuntime = Readonly<{ oauth: GoogleOAuthRuntime; rest: GoogleRestRuntime }>;
export type GoogleExecutionResult = GoogleRestResult & Readonly<{ attemptId: string }>;
export type GoogleOperation = Readonly<{ id: string; role: GoogleResourceRole; storageUpperBytes: number; selection: GooglePickerSelection | null;context:ExternalGoogleContext|null }>;

export type PreparedGoogleExecution=Readonly<{request:GoogleRestRequest;plan:GoogleQuotaPlan;connection:ManagedGoogleConnection;token:string;attemptId:string}>;

/** 인증·범위·한도와 요청 원장을 공통 준비한 후에만 외부 전송을 허용합니다. */
export async function prepareGoogleExecution(db:D1Database,owner:SiteIdentity,settings:GoogleExecutionSettings,input:GoogleRestInput,operation:GoogleOperation,runtime:GoogleExecutionRuntime):Promise<PreparedGoogleExecution> {
  recordId.parse(operation.id);
  await requireCurrentExecutionAuthority(db, owner);
  const request = await prepareGoogleRestRequest(input, operation.role);
  await installGoogleQuotaPolicy(db, owner, settings.quota);
  const access = await requireGoogleAccessToken(db, owner, settings.credentials, runtime.oauth);
  const now: number = runtime.rest.now();
  const plan = boundGoogleResponseQuota(await prepareGoogleQuota(settings.quota, settings.project, owner.userId, access.connection.googleSubject, request.method, now),request.maximumBytes);
  await requireGoogleProviderAvailable(db, owner, plan.projectId, request.method, plan.policyVersion, now);
  const grant = await authorizeGoogleRestResource(db, owner, access.connection, request, operation.selection, now, async (id, role): Promise<unknown> => (await executeGoogleRestAttempt(db, owner, settings, { method: "drive.files.get", fileId: id }, { id: crypto.randomUUID(), role, storageUpperBytes: 0, selection:null,context:operation.context}, runtime)).data);
  if(input.method === "drive.files.update") {
    await readGoogleResource(db,owner,access.connection,input.parentId,"folder-target");
    const parent=await executeGoogleRestAttempt(db,owner,settings,{method:"drive.files.get",fileId:input.parentId},{id:crypto.randomUUID(),role:"folder-target",storageUpperBytes:0,selection:null,context:operation.context},runtime);
    const folder=verifyGoogleFile(parent.data,input.parentId,"folder-target",runtime.rest.now());
    if(folder.role!=="folder-target") throw googleFailure("google_scope_denied","placement-folder");
  }
  requireGoogleResourceGrant(grant, owner.userId, access.connection.connectionId, access.connection.generation, request.method, access.connection.scopes, request.externalId, runtime.rest.now());
  const attemptId: string = operation.id;
  const reservation = { attemptId, requestHash: request.hash, storageBytes: operation.storageUpperBytes, now: runtime.rest.now() };
  if (request.method === "drive.about.get") await reserveGoogleStorageProbe(db, owner, access.connection, plan, reservation);
  else {
    let stored: unknown;
    try { stored = access.connection.storageEvidence === null ? null : JSON.parse(access.connection.storageEvidence); }
    catch (error: unknown) { if (error instanceof SyntaxError) throw googleFailure("google_storage_unverified", "storage-snapshot"); throw error; }
    const evidence = googleStorageEvidence.safeParse(stored);
    if (!evidence.success) throw googleFailure("google_storage_unverified", "storage-snapshot");
    const storage: GoogleStorageEvidence = evidence.data;
    await reserveGoogleRequest(db, owner, access.connection, plan, reservation, storage);
  }
  await recordExternalGoogleRequest(db,owner,attemptId,operation.context,request,runtime.rest.now());
  await beginGoogleRequest(db, owner, attemptId, request.hash, runtime.rest.now());
  return {request,plan,connection:access.connection,token:access.token,attemptId};
}

export async function recordGoogleExecutionFailure(db:D1Database,owner:SiteIdentity,prepared:PreparedGoogleExecution,error:unknown,runtime:GoogleExecutionRuntime):Promise<never> {
  const {attemptId,plan}=prepared;const access={connection:prepared.connection};
    if (!(error instanceof Error && "code" in error && error.code === "google_rest_failed")) {
      await finishGoogleRequest(db, owner, attemptId, { state: "unknown", status: null, errorCode: "unexpected-response-failure", externalId: null, now: runtime.rest.now() }); throw error;
    }
    const failure = error as GoogleRestFailure;
    await finishGoogleRequest(db, owner, attemptId, { state: failure.outcome, status: failure.status, errorCode: failure.reason, externalId: null, now: runtime.rest.now() });
    if (failure.reason === "unauthorized") await markGoogleProviderReconsent(db, owner, access.connection, runtime.rest.now());
    if (["quota", "storage-full", "api-disabled"].includes(failure.reason) && failure.status !== null) await recordGoogleProviderBlock(db, owner, plan, failure.reason as "quota" | "storage-full" | "api-disabled", failure.status, failure.reason === "quota" && (failure.status === 429 || failure.status === 403) ? runtime.rest.now() + Math.max(1000, failure.retryAfterMs ?? 1000) : null, runtime.rest.now());
    throw error;
}

export async function recordGoogleExecutionSuccess(db:D1Database,owner:SiteIdentity,prepared:PreparedGoogleExecution,result:GoogleRestResult,runtime:GoogleExecutionRuntime):Promise<void> {
  const {attemptId,request}=prepared;const access={connection:prepared.connection};
  await finishGoogleRequest(db, owner, attemptId, { state: "succeeded", status: result.status, errorCode: null, externalId: result.externalId, now: runtime.rest.now() });
  const current = await readManagedGoogleConnection(db, owner);
  if (current === null || current.connectionId !== access.connection.connectionId || current.generation !== access.connection.generation || !["active", "partial"].includes(current.state)) throw googleFailure("google_connection_unavailable", "rest-result-generation-changed");
  if (result.externalId !== null && ["docs.documents.create", "sheets.spreadsheets.create", "calendar.calendars.insert", "drive.files.create"].includes(request.method)) await registerGoogleCreatedResource(db, owner, current, attemptId, result.externalId, request.method === "docs.documents.create" ? "docs-target" : request.method === "sheets.spreadsheets.create" ? "sheets-target" : request.method === "drive.files.create" ? "folder-target" : "calendar-target", runtime.rest.now());
}

/** 한 번의 업무 REST 요청을 기록하며 바이너리는 전용 스트림 경로에서 처리합니다. */
export async function executeGoogleRestAttempt(db:D1Database,owner:SiteIdentity,settings:GoogleExecutionSettings,input:GoogleRestInput,operation:GoogleOperation,runtime:GoogleExecutionRuntime):Promise<GoogleExecutionResult> {
  if(input.method==="drive.files.get-media") throw googleFailure("google_configuration_invalid","media-stream-required");
  const prepared=await prepareGoogleExecution(db,owner,settings,input,operation,runtime);
  let result:GoogleRestResult;
  try {result=await sendGoogleRestAttempt(runtime.rest,prepared.request,prepared.token);}
  catch(error:unknown){return recordGoogleExecutionFailure(db,owner,prepared,error,runtime);}
  await recordGoogleExecutionSuccess(db,owner,prepared,result,runtime);
  return {...result,attemptId:prepared.attemptId};
}

/** 기존 짧은 조회 흐름은 각 시도를 동일한 단일 실행·quota 기록 경로로 전달합니다. */
export async function executeGoogleRest(db:D1Database,owner:SiteIdentity,settings:GoogleExecutionSettings,input:GoogleRestInput,operation:GoogleOperation,runtime:GoogleExecutionRuntime):Promise<GoogleExecutionResult> {
  const request=await prepareGoogleRestRequest(input,operation.role);
  for(let attempt:number=1;attempt<=3;attempt+=1) {
    try {return await executeGoogleRestAttempt(db,owner,settings,input,{...operation,id:attempt===1?operation.id:crypto.randomUUID()},runtime);}
    catch(error:unknown) {
      if(!(error instanceof Error && "code" in error && error.code==="google_rest_failed")) throw error;
      const failure=error as GoogleRestFailure;const delay:number|null=googleRestRetryDelay(request,failure,attempt);
      if(delay===null) throw error;
      runtime.rest.warn({event:"google_rest_retry",method:request.method,requestHash:request.hash,attempt,status:failure.status,reason:failure.reason,waitMs:delay});
      await runtime.rest.wait(delay);
    }
  }
  throw googleFailure("google_request_unknown","retry-exhausted");
}
