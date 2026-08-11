// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResearchCapabilityDescriptor, ResearchWorkspaceSnapshot } from "../../../shared/types/researchAgent";
import { normalizeAgentWorkspaceLayoutPrefs } from "../../settings/agentWorkspaceSettings";
import { ResearchAgentWorkbench } from "./ResearchAgentWorkbench";

const api = vi.hoisted(() => ({
  approveResearchPlan: vi.fn(),
  executeResearchPlan: vi.fn(),
  getResearchCapabilityRegistry: vi.fn(),
  getResearchWorkspace: vi.fn(),
  listResearchRuns: vi.fn(),
  saveResearchPlan: vi.fn(),
  listResearchEvidence: vi.fn(),
  listResearchClaimAssessments: vi.fn(),
  assessResearchClaim: vi.fn(),
}));

const chatStore = vi.hoisted(() => ({
  requestOpenChatSession: vi.fn(),
  setActiveChatSessionInStore: vi.fn(),
}));

vi.mock("../../../shared/api/researchAgent", () => ({
  ...api,
  RESEARCH_RUN_CHANGED_EVENT: "latotex.research.run.changed",
}));
vi.mock("../../hooks/chatSessionStore", () => chatStore);

const REGISTRY: ResearchCapabilityDescriptor[] = [{
  id: "project.overview",
  inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
  outputType: "json",
  riskLevel: "read",
  riskReasonKey: "research.capability.risk.read",
  executionTarget: "backend",
  autoAfterPlanApproval: true,
  resourceMode: null,
  idempotency: "safe_replay",
  timeoutMs: 15_000,
  maxRetries: 1,
  undoCapability: null,
  egressCategory: "none",
  requiresNetwork: false,
}];

const SNAPSHOT: ResearchWorkspaceSnapshot = {
  tasks: [{
    id: "task-1",
    projectId: "project-1",
    goal: "Verify the central claim",
    status: "plan_pending",
    currentPlanVersion: 1,
    runIds: [],
    chatSessionId: "chat-1",
    createdAt: "2026-08-07T00:00:00Z",
    updatedAt: "2026-08-07T00:00:00Z",
  }],
  plans: [{
    id: "plan-1",
    taskId: "task-1",
    version: 1,
    sourceMessage: "Verify the central claim",
    approvalStatus: "draft",
    authorizedProjectIds: ["project-1"],
    title: "Evidence review",
    summary: "Validate the claim",
    assumptions: [],
    expectedArtifacts: ["Evidence ledger"],
    acceptanceCriteria: ["Every claim has a source"],
    steps: [],
    createdAt: "2026-08-07T00:00:00Z",
    approvedAt: null,
  }],
  chatStore: { sessions: [], activeSessionId: null, migrationCompleted: true, diagnosticCode: null },
};

describe("ResearchAgentWorkbench", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    api.getResearchWorkspace.mockResolvedValue(SNAPSHOT);
    api.getResearchCapabilityRegistry.mockResolvedValue(REGISTRY);
    api.listResearchRuns.mockResolvedValue([]);
    api.listResearchEvidence.mockResolvedValue([]);
    api.listResearchClaimAssessments.mockResolvedValue([]);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it("keeps one canonical conversation while exposing collapsible task and plan drawers", async () => {
    const onCompactDrawerChange = vi.fn();
    await act(async () => {
      root.render(
        <ResearchAgentWorkbench
          projectId="project-1"
          conversation={<div data-testid="canonical-conversation"><textarea aria-label="canonical-composer" /></div>}
          layoutPrefs={normalizeAgentWorkspaceLayoutPrefs(undefined)}
          desktopLayout={false}
          compactDrawer="tasks"
          onCompactDrawerChange={onCompactDrawerChange}
          onLayoutPrefsChange={vi.fn()}
          onRunProgressChange={vi.fn()}
          t={(key) => String(key)}
        />,
      );
    });
    await act(async () => Promise.resolve());

    expect(container.querySelectorAll("[data-testid='canonical-conversation']")).toHaveLength(1);
    expect(container.querySelectorAll("textarea[aria-label='canonical-composer']")).toHaveLength(1);
    expect(container.textContent).not.toContain("agents.title");
    expect(container.textContent).toContain("Verify the central claim");
    expect(container.querySelector("#research-task-drawer")).not.toBeNull();
    expect(container.querySelector("#research-context-drawer")).toBeNull();

    const taskButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Verify the central claim"));
    await act(async () => taskButton?.click());
    expect(chatStore.setActiveChatSessionInStore).toHaveBeenCalledWith("project-1", "chat-1");
    expect(chatStore.requestOpenChatSession).toHaveBeenCalledWith({ projectId: "project-1", sessionId: "chat-1" });

    onCompactDrawerChange.mockClear();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onCompactDrawerChange).toHaveBeenCalledWith(null);
  });

  it("keeps inspector tabs controlled by the project-scoped layout preference", async () => {
    const onLayoutPrefsChange = vi.fn();
    const layoutPrefs = normalizeAgentWorkspaceLayoutPrefs({ inspectorTab: "plan" });
    await act(async () => {
      root.render(
        <ResearchAgentWorkbench
          projectId="project-1"
          conversation={<div data-testid="canonical-conversation" />}
          layoutPrefs={layoutPrefs}
          desktopLayout={false}
          compactDrawer="inspector"
          onCompactDrawerChange={vi.fn()}
          onLayoutPrefsChange={onLayoutPrefsChange}
          onRunProgressChange={vi.fn()}
          t={(key) => String(key)}
        />,
      );
    });
    await act(async () => Promise.resolve());

    const evidenceTab = Array.from(container.querySelectorAll<HTMLButtonElement>("button[role='tab']"))
      .find((button) => button.textContent === "research.workbench.contextEvidence");
    await act(async () => evidenceTab?.click());

    expect(onLayoutPrefsChange).toHaveBeenCalledWith({ ...layoutPrefs, inspectorTab: "evidence" });
    expect(container.querySelectorAll("[data-testid='canonical-conversation']")).toHaveLength(1);
  });
});
