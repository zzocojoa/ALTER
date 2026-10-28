import { domainFailure } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import { editorAiIntent } from "../../lib/editor/ai-observation.ts";
import type { EditorAiIntent } from "../../lib/editor/ai-observation.ts";
import type { TutorAiObservation } from "../../lib/tutor/ai-observation.ts";
import { getTutor } from "./tutor.ts";
import { readTutorTransitionObservation } from "./tutor-ai-observation.ts";

const scopes = { feedback: ["tutor.editor-feedback", "tutor.editor-feedback-complete"], review: ["tutor.editor-review", "tutor.editor-review-complete"], variation: ["tutor.variation", "tutor.variation-complete"] } as const;
export async function readEditorAiObservation(db: D1Database, owner: SiteIdentity, intent: EditorAiIntent): Promise<TutorAiObservation> {
  const { input, key } = editorAiIntent.parse(intent);
  if (input.action === "recover") throw domainFailure("validation", "editor.ai-observation-new-request-required", null);
  if (!(await getTutor(db, owner, input.id)).editor) throw domainFailure("reference_conflict", "editor.session-required", null);
  const [beginScope, completionScope] = scopes[input.action];
  return readTutorTransitionObservation(db, owner, { key, input, beginScope, completionScope });
}
