import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createResearchTask,
  getResearchWorkspace,
  startResearchPlanningWorkflow,
} from "../../../shared/api/researchAgent";
import type { ResearchTask } from "../../../shared/types/researchAgent";
import {
  ensureResearchConversationTask,
  startResearchConversationPlanning,
} from "./researchConversationPlanning";

vi.mock("../../../shared/api/researchAgent", () => ({
  createResearchTask: vi.fn(),
  getResearchWorkspace: vi.fn(),
  startResearchPlanningWorkflow: vi.fn(),
}));

const TASK: ResearchTask = {
  id: "task-1",
  projectId: "project-1",
  goal: "Verify the primary outcome",
  status: "discussion",
  currentPlanVersion: null,
  runIds: [],
  chatSessionId: "chat-1",
  createdAt: "2026-05-19T00:00:00.000Z",
  updatedAt: "2026-05-19T00:00:00.000Z",
};

function workspaceWith(tasks: ResearchTask[]) {
  return {
    tasks,
    plans: [],
    chatStore: {
      sessions: [],
      activeSessionId: null,
      migrationCompleted: true,
      diagnosticCode: null,
    },
  };
}

describe("researchConversationPlanning", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("reuses the task already linked to the canonical chat session", async () => {
    vi.mocked(getResearchWorkspace).mockResolvedValue(workspaceWith([TASK]));

    const result = await ensureResearchConversationTask({
      projectId: "project-1",
      sessionId: "chat-1",
      prompt: "Clarify the target population",
    });

    expect(result).toEqual(TASK);
    expect(createResearchTask).not.toHaveBeenCalled();
  });

  it("creates a discussion task with the chat session identity", async () => {
    vi.mocked(getResearchWorkspace).mockResolvedValue(workspaceWith([]));
    vi.mocked(createResearchTask).mockResolvedValue(TASK);

    const result = await ensureResearchConversationTask({
      projectId: "project-1",
      sessionId: "chat-1",
      prompt: "Verify the primary outcome",
    });

    expect(result).toEqual(TASK);
    expect(createResearchTask).toHaveBeenCalledWith(
      "project-1",
      "Verify the primary outcome",
      "chat-1",
    );
  });

  it("uses only the restricted planning entry and propagates model unavailability", async () => {
    vi.mocked(startResearchPlanningWorkflow)
      .mockResolvedValueOnce({ runId: "run-plan-1", status: "accepted" })
      .mockRejectedValueOnce(new Error("research.planning.model_unavailable"));

    await expect(startResearchConversationPlanning({
      projectId: "project-1",
      taskId: "task-1",
      prompt: "Build a reviewable plan",
      modelOverride: "model-1",
    })).resolves.toEqual({ runId: "run-plan-1", status: "accepted" });
    expect(startResearchPlanningWorkflow).toHaveBeenCalledWith({
      projectId: "project-1",
      taskId: "task-1",
      prompt: "Build a reviewable plan",
      modelOverride: "model-1",
    });

    await expect(startResearchConversationPlanning({
      projectId: "project-1",
      taskId: "task-1",
      prompt: "Retry without a model",
    })).rejects.toThrow("research.planning.model_unavailable");
    expect(startResearchPlanningWorkflow).toHaveBeenCalledTimes(2);
  });
});
