import { domainFailure,recordId,contentHash } from "../../lib/domain/contracts.ts";
import type { Command,SiteIdentity } from "../../lib/domain/contracts.ts";
import { weeklyWorkspace,weeklyStart,weeklyEdit,validatedWeeklyDraft } from "../../lib/weekly/workspace.ts";
import type { WeeklyWorkspace,WeeklyStart,WeeklyEdit } from "../../lib/weekly/workspace.ts";
import { weeklyAiRequest } from "../../lib/weekly/ai.ts";
import type { WeeklyProposal } from "../../lib/weekly/planning.ts";
import { requireMaterialVisibility } from "./material-access.ts";
import { readWeeklyContext } from "./weekly-context.ts";
import type { WeeklyContext } from "./weekly-context.ts";
import { weeklyEvidenceGuards } from "./weekly-evidence.ts";
import { listConfirmedUnits,currentUnitGuard,currentSourceGuard } from "./librarian-links.ts";
import { executeAtomic,readAtomicReceipt,readStorage,guardedUpdate } from "./atomic.ts";
import type { Receipt } from "./atomic.ts";

export async function readWeeklyWorkspace(db:D1Database,owner:SiteIdentity,id:string):Promise<WeeklyWorkspace> {
  recordId.parse(id);await requireMaterialVisibility(db,owner);
  const row=await readStorage("weekly.workspace-read",()=>db.prepare("SELECT s.version,d.content FROM weekly_summaries s JOIN weekly_drafts d ON d.owner_id=s.owner_id AND d.summary_id=s.id WHERE s.owner_id=? AND s.id=?").bind(owner.userId,id).first<{version:number;content:string}>());
  if(!row) throw domainFailure("reference_conflict","weekly.workspace-owner",{id});
  const state=weeklyWorkspace.parse(JSON.parse(row.content));if(state.version!==row.version) throw domainFailure("reference_conflict","weekly.workspace-version",{id});return state;
}
export async function loadWeeklyBasis(db:D1Database,bucket:R2Bucket,owner:SiteIdentity,input:WeeklyStart):Promise<Readonly<{current:WeeklyContext;state:WeeklyWorkspace}>> {
  const current=await readWeeklyContext(db,bucket,owner,input.courseId,input.date);const units=(await listConfirmedUnits(db,owner)).filter(unit=>unit.courseId===input.courseId);
  if(units.length===0 || new Set(units.map(unit=>unit.planVersionId)).size!==1) throw domainFailure("reference_conflict","weekly.current-confirmed-plan",{courseId:input.courseId});
  const context={aggregate:current.snapshot.aggregate,units,sources:current.sources.flatMap(source=>source.valid && source.source ? [source.source] : []),availableMinutes:input.availableMinutes};
  const fingerprint=await contentHash({evidence:current.fingerprint,units});
  return {current,state:weeklyWorkspace.parse({id:input.id,courseId:input.courseId,date:input.date,version:1,context,fingerprint,phase:"draft",proposal:null,claims:[],notes:"",pendingKey:null,confirmedVersionId:null})};
}
export async function requireCurrentWeekly(db:D1Database,bucket:R2Bucket,owner:SiteIdentity,state:WeeklyWorkspace):Promise<WeeklyContext> {
  const fresh=await loadWeeklyBasis(db,bucket,owner,{id:state.id,courseId:state.courseId,date:state.date,availableMinutes:state.context.availableMinutes});
  if(fresh.state.fingerprint!==state.fingerprint) throw domainFailure("version_conflict","weekly.evidence-changed-reload",{id:state.id});return fresh.current;
}
export function weeklyWorkspaceGuards(db:D1Database,owner:SiteIdentity,state:WeeklyWorkspace,current:WeeklyContext,requestId:string):readonly D1PreparedStatement[] {
  return [...weeklyEvidenceGuards(db,owner,current.snapshot,requestId,100),...state.context.units.map((unit,index)=>currentUnitGuard(db,owner,unit,requestId,200+index)),...state.context.sources.map((source,index)=>currentSourceGuard(db,owner,source,requestId,400+index))];
}
export async function createWeeklyWorkspace(db:D1Database,bucket:R2Bucket,cmd:Command,value:WeeklyStart):Promise<Receipt> {
  const input=weeklyStart.parse(value);const replay=await readAtomicReceipt(db,cmd,"weekly.workspace-create",input,input.id);if(replay) return replay;
  if(cmd.expectedVersion!==1) throw domainFailure("version_conflict","weekly.create-version",null);const {current,state}=await loadWeeklyBasis(db,bucket,cmd.owner,input);const period=state.context.aggregate.period;
  return executeAtomic(db,cmd,"weekly.workspace-create",input,input.id,1,requestId=>[...weeklyWorkspaceGuards(db,cmd.owner,state,current,requestId),db.prepare("INSERT INTO weekly_summaries VALUES (?,?,1,?,?,?,?)").bind(cmd.owner.userId,input.id,requestId,period.start,period.endExclusive,input.courseId),db.prepare("INSERT INTO weekly_drafts VALUES (?,?,1,?,?,?)").bind(cmd.owner.userId,input.id,requestId,input.id,JSON.stringify(state))]);
}
export async function persistWeeklyWorkspace(db:D1Database,cmd:Command,operation:string,payload:unknown,state:WeeklyWorkspace,next:WeeklyWorkspace,current:WeeklyContext):Promise<Receipt> {
  if(cmd.expectedVersion!==state.version || next.version!==state.version+1 || next.id!==state.id) throw domainFailure("version_conflict","weekly.edit-version",{id:state.id});
  return executeAtomic(db,cmd,operation,payload,state.id,next.version,requestId=>weeklyWorkspaceStatements(db,cmd,state,next,current,requestId));
}
export async function saveWeeklyWorkspace(db:D1Database,bucket:R2Bucket,cmd:Command,id:string,value:WeeklyEdit):Promise<Receipt> {
  const input=weeklyEdit.parse(value);const replay=await readAtomicReceipt(db,cmd,"weekly.workspace-save",{id,input},id);if(replay) return replay;const state=await readWeeklyWorkspace(db,cmd.owner,id);
  if(state.phase==="generating") throw domainFailure("version_conflict","weekly.generation-pending",{id});const current=await requireCurrentWeekly(db,bucket,cmd.owner,state);
  return persistWeeklyWorkspace(db,cmd,"weekly.workspace-save",{id,input},state,validatedWeeklyDraft(state,input),current);
}
export async function beginWeeklyAi(db:D1Database,bucket:R2Bucket,cmd:Command,id:string):Promise<Receipt> {
  const replay=await readAtomicReceipt(db,cmd,"weekly.workspace-generate",{id},id);if(replay) return replay;const state=await readWeeklyWorkspace(db,cmd.owner,id);const current=await requireCurrentWeekly(db,bucket,cmd.owner,state);
  if(state.phase==="generating") throw domainFailure("version_conflict","weekly.generation-pending",{id});weeklyAiRequest(state.context);
  const next=weeklyWorkspace.parse({...state,version:state.version+1,phase:"generating",pendingKey:`weekly:${id}:${cmd.requestKey}`,confirmedVersionId:null});
  return persistWeeklyWorkspace(db,cmd,"weekly.workspace-generate",{id},state,next,current);
}
export async function saveWeeklyAi(db:D1Database,bucket:R2Bucket,owner:SiteIdentity,state:WeeklyWorkspace,proposal:WeeklyProposal):Promise<Receipt> {
  if(!state.pendingKey || state.phase!=="generating" || state.context.availableMinutes===null) throw domainFailure("version_conflict","weekly.generation-state",{id:state.id});
  const cmd={owner,expectedVersion:state.version,requestKey:`save:${state.pendingKey}`};const payload={id:state.id,proposal};const replay=await readAtomicReceipt(db,cmd,"weekly.workspace-ai-save",payload,state.id);if(replay) return replay;const current=await requireCurrentWeekly(db,bucket,owner,state);
  return persistWeeklyWorkspace(db,cmd,"weekly.workspace-ai-save",payload,state,validatedWeeklyDraft(state,{availableMinutes:state.context.availableMinutes,proposal,notes:state.notes}),current);
}

export async function setWeeklyTime(db:D1Database,bucket:R2Bucket,cmd:Command,id:string,availableMinutes:number):Promise<Receipt> {
  weeklyEdit.shape.availableMinutes.parse(availableMinutes);const payload={id,availableMinutes};const replay=await readAtomicReceipt(db,cmd,"weekly.workspace-time",payload,id);if(replay) return replay;
  const state=await readWeeklyWorkspace(db,cmd.owner,id);if(state.phase==="generating") throw domainFailure("version_conflict","weekly.generation-pending",{id});const current=await requireCurrentWeekly(db,bucket,cmd.owner,state);
  const next=weeklyWorkspace.parse({...state,version:state.version+1,context:{...state.context,availableMinutes},phase:state.proposal ? "proposed" : "draft",confirmedVersionId:null});
  return persistWeeklyWorkspace(db,cmd,"weekly.workspace-time",payload,state,next,current);
}
export async function refreshWeeklyEvidence(db:D1Database,bucket:R2Bucket,cmd:Command,id:string):Promise<Receipt> {
  const payload={id};const replay=await readAtomicReceipt(db,cmd,"weekly.workspace-refresh",payload,id);if(replay) return replay;const state=await readWeeklyWorkspace(db,cmd.owner,id);
  if(state.phase==="generating") throw domainFailure("version_conflict","weekly.generation-pending",{id});const fresh=await loadWeeklyBasis(db,bucket,cmd.owner,{id:state.id,courseId:state.courseId,date:state.date,availableMinutes:state.context.availableMinutes});
  const next=weeklyWorkspace.parse({...fresh.state,version:state.version+1,notes:state.notes});
  return persistWeeklyWorkspace(db,cmd,"weekly.workspace-refresh",payload,{...fresh.state,version:state.version},next,fresh.current);
}

export function weeklyWorkspaceStatements(db:D1Database,cmd:Command,state:WeeklyWorkspace,next:WeeklyWorkspace,current:WeeklyContext,requestId:string):readonly D1PreparedStatement[] {
  return [...weeklyWorkspaceGuards(db,cmd.owner,state,current,requestId),...guardedUpdate(db,"weekly_summaries",cmd.owner.userId,state.id,state.version,requestId,0,"period_start=period_start",[],"1",[]),...guardedUpdate(db,"weekly_drafts",cmd.owner.userId,state.id,state.version,requestId,1,"content=?",[JSON.stringify(next)],"summary_id=?",[state.id])];
}
