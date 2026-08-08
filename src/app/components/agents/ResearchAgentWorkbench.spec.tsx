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
  listResearchEvidence: vi.fn(),
  listResearchClaimAssessments: vi.fn(),
  assessResearchClaim: vi.fn(),
}));

vi.mock("../../../shared/api/researchAgent", () => api);

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
    api.createResearchTask.mockResolvedValue({
      id: "task-1",
      projectId: "project-1",
      goal: "Verify the central claim",
      status: "discussion",
      currentPlanVersion: null,
      runIds: [],
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

  it("creates a persisted editable plan before any execution can start", async () => {
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

    expect(api.createResearchTask).toHaveBeenCalledWith("project-1", "Verify the central claim");
    expect(api.saveResearchPlan).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      taskId: "task-1",
      authorizedProjectIds: ["project-1"],
      steps: expect.arrayContaining([
        expect.objectContaining({ capability: "project.overview", riskLevel: "read" }),
        expect.objectContaining({ capability: "literature.search", riskLevel: "read" }),
      ]),
    }));
    expect(api.executeResearchPlan).not.toHaveBeenCalled();
  });
});
