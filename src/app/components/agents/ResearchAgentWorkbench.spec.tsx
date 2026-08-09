// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResearchCapabilityDescriptor } from "../../../shared/types/researchAgent";
import { ResearchAgentWorkbench } from "./ResearchAgentWorkbench";

const api = vi.hoisted(() => ({
  approveResearchPlan: vi.fn(),
  createResearchTask: vi.fn(),
  executeResearchPlan: vi.fn(),
  getResearchCapabilityRegistry: vi.fn(),
  getResearchWorkspace: vi.fn(),
  listResearchRuns: vi.fn(),
  saveResearchPlan: vi.fn(),
  startResearchPlanningWorkflow: vi.fn(),
  listResearchEvidence: vi.fn(),
  listResearchClaimAssessments: vi.fn(),
  assessResearchClaim: vi.fn(),
}));

vi.mock("../../../shared/api/researchAgent", () => api);

const chatStore = vi.hoisted(() => ({
  loadChatStore: vi.fn(),
  newChatSession: vi.fn(),
  saveChatStoreAndWait: vi.fn(),
}));

const runWait = vi.hoisted(() => ({
  waitForRunOutputWithPolicy: vi.fn(),
}));

vi.mock("../../hooks/chatSessionStore", () => chatStore);
vi.mock("../../hooks/runEventWait", () => runWait);

const REGISTRY: ResearchCapabilityDescriptor[] = [
  {
    id: "project.overview",
    riskLevel: "read",
    executionTarget: "backend",
    autoAfterPlanApproval: true,
    resourceMode: null,
    requiresNetwork: false,
  },
  {
    id: "literature.search",
    riskLevel: "read",
    executionTarget: "backend",
    autoAfterPlanApproval: true,
    resourceMode: null,
    requiresNetwork: true,
  },
];

describe("ResearchAgentWorkbench", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    api.getResearchWorkspace.mockResolvedValue({
      tasks: [],
      plans: [],
      chatStore: { sessions: [], activeSessionId: null, migrationCompleted: true, diagnosticCode: null },
    });
    api.getResearchCapabilityRegistry.mockResolvedValue(REGISTRY);
    api.listResearchRuns.mockResolvedValue([]);
    api.listResearchEvidence.mockResolvedValue([]);
    api.listResearchClaimAssessments.mockResolvedValue([]);
    api.startResearchPlanningWorkflow.mockResolvedValue({ runId: "planning-run-1", status: "accepted" });
    runWait.waitForRunOutputWithPolicy.mockResolvedValue("I prepared a reviewable plan.");
    chatStore.newChatSession.mockReturnValue({
      id: "chat-1",
      title: "Verify the central claim",
      createdAt: "2026-08-07T00:00:00Z",
      updatedAt: "2026-08-07T00:00:00Z",
      messages: [],
    });
    chatStore.loadChatStore.mockReturnValue({ sessions: [], activeSessionId: null });
    chatStore.saveChatStoreAndWait.mockImplementation(async (_projectId, sessions, activeSessionId) => {
      const stored = { sessions, activeSessionId };
      chatStore.loadChatStore.mockReturnValue(stored);
      return stored;
    });
    api.createResearchTask.mockResolvedValue({
      id: "task-1",
      projectId: "project-1",
      goal: "Verify the central claim",
      status: "discussion",
      currentPlanVersion: null,
      runIds: [],
      chatSessionId: "chat-1",
      createdAt: "2026-08-07T00:00:00Z",
      updatedAt: "2026-08-07T00:00:00Z",
    });
    api.saveResearchPlan.mockResolvedValue({
      id: "plan-1",
      taskId: "task-1",
      version: 1,
      sourceMessage: "Verify the central claim",
      approvalStatus: "draft",
      authorizedProjectIds: ["project-1"],
      title: "Evidence review",
      summary: "Validate the claim",
      assumptions: [],
      expectedArtifacts: [],
      acceptanceCriteria: [],
      steps: [],
      createdAt: "2026-08-07T00:00:00Z",
      approvedAt: null,
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("starts model-backed planning without creating a deterministic fallback plan", async () => {
    await act(async () => {
      root.render(<ResearchAgentWorkbench projectId="project-1" t={(key) => String(key)} />);
    });
    await act(async () => Promise.resolve());

    const goalInput = container.querySelector("textarea");
    expect(goalInput).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(goalInput, "Verify the central claim");
      goalInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const createButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("research.workbench.createPlan"));
    await act(async () => createButton?.click());

    expect(api.createResearchTask).toHaveBeenCalledWith(
      "project-1",
      "Verify the central claim",
      "chat-1",
    );
    expect(api.startResearchPlanningWorkflow).toHaveBeenCalledWith({
      projectId: "project-1",
      taskId: "task-1",
      prompt: "Verify the central claim",
    });
    expect(api.saveResearchPlan).not.toHaveBeenCalled();
    expect(api.executeResearchPlan).not.toHaveBeenCalled();
  });
});
