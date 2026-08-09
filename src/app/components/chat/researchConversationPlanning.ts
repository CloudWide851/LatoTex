import {
  createResearchTask,
  getResearchWorkspace,
  startResearchPlanningWorkflow,
} from "../../../shared/api/researchAgent";
import type { ResearchTask } from "../../../shared/types/researchAgent";
import {
  emitOnboardingMilestone,
  ONBOARDING_RESEARCH_QUESTION_EVENT,
} from "../../onboarding/onboardingState";

export async function ensureResearchConversationTask(input: {
  projectId: string;
  sessionId: string;
  prompt: string;
}): Promise<ResearchTask> {
  const snapshot = await getResearchWorkspace(input.projectId);
  const existing = snapshot.tasks.find((task) => task.chatSessionId === input.sessionId);
  if (existing) {
    return existing;
  }
  const created = await createResearchTask(input.projectId, input.prompt, input.sessionId);
  emitOnboardingMilestone(ONBOARDING_RESEARCH_QUESTION_EVENT, input.projectId);
  return created;
}

export function startResearchConversationPlanning(input: {
  projectId: string;
  taskId: string;
  prompt: string;
  modelOverride?: string | null;
}) {
  return startResearchPlanningWorkflow({
    projectId: input.projectId,
    taskId: input.taskId,
    prompt: input.prompt,
    modelOverride: input.modelOverride ?? undefined,
  });
}
