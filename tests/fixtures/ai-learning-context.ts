import type { LearningContext } from "../../lib/ai/learning-contract.ts";

export function emptyLearningContext(): LearningContext {
  return { pages: [], sources: [], unitIds: [], latestResult: null, latestEvidence: [], attempts: [], currentCorrectionId: null, expectedHelpStage: "direction", feedbackIds: [], revision: null, relatedReviews: [], errorId: null, availableMinutesPerWeek: 120, delayedRecallDueAt: null };
}
