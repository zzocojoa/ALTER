import { validateEditorHistory } from "./history.ts";
import { domainFailure } from "../domain/contracts.ts";
import type { TutorState } from "../tutor/contracts.ts";
import type { EditorFeedbackOutput,EditorVersion } from "./contracts.ts";

export function currentEditorVersion(state:TutorState):EditorVersion {
  validateEditorHistory(state);
  const value=state.editor?.versions.find((item):boolean=>item.id===state.editor?.currentVersionId);
  if(!value || value.answerId!==state.currentAnswerId || value.planVersionId!==state.start.bundle.unit.planVersionId || value.unitVersion!==state.start.bundle.unit.unitVersion) throw domainFailure("reference_conflict","editor.saved-version-required",null);
  return value;
}
export function validateEditorFeedback(state:TutorState,output:EditorFeedbackOutput):void {
  const draft=currentEditorVersion(state);
  if(output.versionId!==draft.id || output.answerId!==draft.answerId || (output.items.length===0)!==(output.verdict==="no-issue-evidenced")) throw domainFailure("reference_conflict","editor.feedback-version-verdict",null);
  for(const basis of output.basis) {
    const criterion=basis.criterion==="self-explanation" ? state.start.bundle.unit.selfExplanationCriterion : state.start.bundle.unit.newConditionCriterion;
    if(basis.criterionQuote!==criterion) throw domainFailure("reference_conflict","editor.exact-criterion-required",null);
    const place=basis.location;
    if(place.kind==="text" ? place.end<=place.start || place.end>Array.from(draft.text).length || Array.from(draft.text).slice(place.start,place.end).join("")!==place.quote : !draft.fileIds.includes(place.fileId) || place.right<=place.left || place.bottom<=place.top) throw domainFailure("reference_conflict","editor.actual-draft-location-required",null);
  }
  const directions={definition:"check-definition",reasoning:"explain-reason",condition:"compare-condition",calculation:"check-calculation",readability:"clarify-writing"} as const;
  for(const item of output.items) {
    if(!output.basis[item.basisIndex] || directions[item.issue]!==item.direction) throw domainFailure("reference_conflict","editor.issue-direction-required",null);
    if(item.issue === "readability" && output.basis[item.basisIndex].location.kind !== "image") throw domainFailure("reference_conflict", "editor.readability-image-evidence-required", null);
    if(item.citations.some((citation):boolean=>!state.start.bundle.sources.some((source):boolean=>source.id===citation.sourceRefId && source.evidence.includes(citation.quote)))) throw domainFailure("reference_conflict","editor.exact-source-required",null);
  }
}
