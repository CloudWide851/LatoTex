// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getResearchWorkspace,
  listResearchEvidence,
  listResearchRuns,
} from "../../../shared/api/researchAgent";
import type { ResearchTask, ResearchWorkspaceSnapshot } from "../../../shared/types/researchAgent";
import { ProjectOverviewWorkspace } from "./ProjectOverviewWorkspace";

vi.mock("../../../shared/api/researchAgent", () => ({
  getResearchWorkspace: vi.fn(),
  listResearchEvidence: vi.fn(),
  listResearchRuns: vi.fn(),
}));

const EMPTY_SNAPSHOT: ResearchWorkspaceSnapshot = {
  tasks: [],
  plans: [],
  chatStore: {
    sessions: [],
    activeSessionId: null,
    migrationCompleted: true,
    diagnosticCode: null,
  },
};

const TASK: ResearchTask = {
  id: "task-1",
  projectId: "project-1",
  goal: "Verify a reproducible claim",
  status: "plan_pending",
  currentPlanVersion: 1,
  runIds: [],
  chatSessionId: null,
  createdAt: "2026-08-07T00:00:00Z",
  updatedAt: "2026-08-07T00:00:00Z",
};

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("ProjectOverviewWorkspace", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.mocked(listResearchRuns).mockResolvedValue([]);
    vi.mocked(listResearchEvidence).mockResolvedValue([]);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it("loads the project brief without blocking the workspace and creates the first objective", async () => {
    vi.mocked(getResearchWorkspace)
      .mockResolvedValueOnce(EMPTY_SNAPSHOT)
      .mockResolvedValue({ ...EMPTY_SNAPSHOT, tasks: [TASK] });
    const onProjectGoalSave = vi.fn();

    await act(async () => {
      root.render(
        <ProjectOverviewWorkspace
          projectId="project-1"
          libraryTree={[]}
          compileDiagnostics={[]}
          compiledPdfUrl={null}
          settings={null}
          chatAgentModelId={null}
          onPageChange={vi.fn()}
          onOnboardingDismiss={vi.fn()}
          onOnboardingRestart={vi.fn()}
          onOnboardingRecordStep={vi.fn()}
          onProjectGoalSave={onProjectGoalSave}
          onResearchDomainChange={vi.fn()}
          onResearchPrivacyReview={vi.fn()}
          t={(key) => String(key)}
        />,
      );
    });
    await flushEffects();

    const textarea = container.querySelector("textarea");
    expect(textarea).not.toBeNull();
    await act(async () => {
      if (textarea) {
        const valueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          "value",
        )?.set;
        valueSetter?.call(textarea, "Verify a reproducible claim");
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    const createButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("overview.goal.create"));
    expect(createButton?.hasAttribute("disabled")).toBe(false);
    await act(async () => {
      createButton?.click();
    });
    await flushEffects();

    expect(onProjectGoalSave).toHaveBeenCalledWith("Verify a reproducible claim");
  });

  it("shows evidence and active-run progress from persisted research state", async () => {
    vi.mocked(getResearchWorkspace).mockResolvedValue({ ...EMPTY_SNAPSHOT, tasks: [TASK] });
    vi.mocked(listResearchRuns).mockResolvedValue([{
      runId: "run-1",
      projectId: "project-1",
      taskId: TASK.id,
      planVersion: 1,
      status: "running",
      currentStepId: "step-2",
      completedSteps: 1,
      totalSteps: 3,
      lastOperation: "literature.search",
      evidenceCount: 1,
      diagnosticCode: null,
      startedAt: "2026-08-07T00:00:00Z",
      updatedAt: "2026-08-07T00:00:00Z",
      finishedAt: null,
    }]);
    vi.mocked(listResearchEvidence).mockResolvedValue([{
      id: "evidence-1",
      taskId: TASK.id,
      runId: "run-1",
      source: "crossref",
      doi: "10.1000/example",
      sourceVersion: null,
      title: "A reproducible result",
      excerpt: "The result was reproduced.",
      locator: { page: 2, section: "Results", paragraph: "3" },
      contentHash: "abc",
      retractionStatus: "clear",
      correctionStatus: "none",
      sourceUrl: "https://example.invalid",
      createdAt: "2026-08-07T00:00:00Z",
    }]);

    await act(async () => {
      root.render(
        <ProjectOverviewWorkspace
          projectId="project-1"
          libraryTree={[]}
          compileDiagnostics={[]}
          compiledPdfUrl="blob:compiled"
          settings={null}
          chatAgentModelId={null}
          onPageChange={vi.fn()}
          onOnboardingDismiss={vi.fn()}
          onOnboardingRestart={vi.fn()}
          onOnboardingRecordStep={vi.fn()}
          onProjectGoalSave={vi.fn()}
          onResearchDomainChange={vi.fn()}
          onResearchPrivacyReview={vi.fn()}
          t={(key) => String(key)}
        />,
      );
    });
    await flushEffects();

    expect(listResearchEvidence).toHaveBeenCalledWith("project-1", TASK.id);
    expect(container.textContent).toContain("1/3");
    expect(container.textContent).toContain("overview.next.plan");
  });
});
