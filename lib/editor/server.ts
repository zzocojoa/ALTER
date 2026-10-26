import { domainFailure } from "../domain/contracts";
import { readEditorRechecks } from "../../db/repositories/editor-history";
import { env } from "cloudflare:workers";
import { getTutor,requireTutorViewAccess } from "../../db/repositories/tutor";
import { readStorage } from "../../db/repositories/atomic";
import { readTutorView } from "../tutor/server";
import { tutorOverview } from "../tutor/overview";
import type { TutorOverview } from "../tutor/overview";
import type { SiteIdentity } from "../domain/contracts";
import { publicEditorView } from "./view";
import type { EditorView } from "./view";
export async function readEditorOverview(owner:SiteIdentity):Promise<TutorOverview> {
  const history=await readStorage("editor.history",()=>env.DB.prepare("SELECT id,version,json_extract(state,'$.start.bundle.unit.title') AS title,json_extract(state,'$.phase') AS phase FROM tutor_sessions WHERE owner_id=? AND json_type(state,'$.editor')='object' ORDER BY rowid DESC LIMIT 30").bind(owner.userId).all());
  const scopes=await readStorage("editor.scopes",()=>env.DB.prepare("SELECT id,json_extract(state,'$.unit.title') AS title,json_extract(state,'$.input.date') AS date FROM study_scopes WHERE owner_id=? AND json_extract(state,'$.phase')='confirmed' ORDER BY rowid DESC LIMIT 30").bind(owner.userId).all());
  return tutorOverview.parse({history:history.results,scopes:scopes.results});
}
export async function readEditorView(owner:SiteIdentity,id:string):Promise<EditorView> {
  await requireTutorViewAccess(env.DB,owner,id);const state=await getTutor(env.DB,owner,id);const view=publicEditorView(state);const tutor=await readTutorView(owner,id);
  if(tutor.version!==state.version) throw domainFailure("version_conflict","editor.resume-mixed-version",null);
  const checks=await readEditorRechecks(env.DB,env.BUCKET,owner,state);
  return {...view,tutor,transfer:view.transfer && !tutor.current ? {...view.transfer,candidate:false} : view.transfer,reviews:view.reviews.map((review)=>({...review,needsRecheck:checks.some((check)=>check.reason!==null && (check.feedbackId===review.feedbackId || state.editor?.feedbacks.some((feedback)=>feedback.id===check.feedbackId && feedback.output.versionId===review.versionId)))})),feedbacks:view.feedbacks.map((feedback)=>({...feedback,needsRecheck:checks.some((check)=>check.feedbackId===feedback.id && check.reason!==null)}))};
}
