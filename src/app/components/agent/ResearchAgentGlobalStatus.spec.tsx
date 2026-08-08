// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResearchAgentRuntimeProjection } from "../../hooks/useResearchAgentRuntime";
import { ResearchAgentGlobalStatus } from "./ResearchAgentGlobalStatus";

function runtimeProjection(): ResearchAgentRuntimeProjection {
  const primaryRun = {
    runId: "run-1",
    projectId: "project-1",
    taskId: "task-1",
    planVersion: 2,
    status: "running",
    currentStepId: "step-2",
    completedSteps: 1,
    totalSteps: 4,
    lastOperation: "literature.search",
    evidenceCount: 3,
    diagnosticCode: null,
    startedAt: new Date(Date.now() - 10_000).toISOString(),
    updatedAt: new Date().toISOString(),
    finishedAt: null,
  };
  return {
    activeRuns: [primaryRun],
    approvals: [],
    locks: [{
      lockId: "lock-1",
      projectId: "project-1",
      resourcePath: "manuscript/main.tex",
      mode: "write",
      runId: "run-1",
      heartbeatAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
    }],
    primaryRun,
    primaryTaskGoal: "Establish a reproducible result",
    pauseRun: vi.fn(async () => undefined),
    resumeRun: vi.fn(async () => undefined),
    cancelRun: vi.fn(async () => undefined),
    resolveApproval: vi.fn(async () => undefined),
    refresh: vi.fn(async () => undefined),
  };
}

describe("ResearchAgentGlobalStatus", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
  });

  it("portals a non-blocking work frame and keeps pause, follow, and navigation interactive", async () => {
    const runtime = runtimeProjection();
    const onJumpToResource = vi.fn();
    const onOpenAgent = vi.fn();
    await act(async () => {
      root.render(
        <ResearchAgentGlobalStatus
          runtime={runtime}
          onOpenAgent={onOpenAgent}
          onJumpToResource={onJumpToResource}
          t={(key) => String(key)}
        />,
      );
    });

    const frame = document.body.querySelector('[data-research-agent-frame="active"]');
    expect(frame?.className).toContain("pointer-events-none");
    expect(document.body.textContent).toContain("Establish a reproducible result");

    const pause = Array.from(document.body.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("research.agent.pause"));
    await act(async () => pause?.click());
    expect(runtime.pauseRun).toHaveBeenCalledWith("run-1");

    const follow = Array.from(document.body.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("research.agent.follow"));
    await act(async () => follow?.click());
    expect(onJumpToResource).toHaveBeenCalledTimes(1);
    expect(onJumpToResource).toHaveBeenCalledWith("manuscript/main.tex");

    const open = Array.from(document.body.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("research.agent.open"));
    await act(async () => open?.click());
    expect(onOpenAgent).toHaveBeenCalledTimes(1);
  });

  it("shows approval controls only in expanded details and removes the frame when idle", async () => {
    const runtime = runtimeProjection();
    runtime.approvals = [{
      approvalId: "approval-1",
      projectId: "project-1",
      runId: "run-1",
      stepId: "step-2",
      riskLevel: "high",
      commandSummary: "git.commit",
      status: "pending",
      createdAt: new Date().toISOString(),
      resolvedAt: null,
    }];
    await act(async () => {
      root.render(
        <ResearchAgentGlobalStatus
          runtime={runtime}
          onOpenAgent={vi.fn()}
          onJumpToResource={vi.fn()}
          t={(key) => String(key)}
        />,
      );
    });
    const expand = document.body.querySelector('button[aria-label="research.agent.expand"]');
    await act(async () => expand?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const approve = Array.from(document.body.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("research.agent.approve"));
    await act(async () => approve?.click());
    expect(runtime.resolveApproval).toHaveBeenCalledWith("approval-1", "approved");

    await act(async () => {
      root.render(
        <ResearchAgentGlobalStatus
          runtime={{ ...runtime, activeRuns: [], primaryRun: null, primaryTaskGoal: "" }}
          onOpenAgent={vi.fn()}
          onJumpToResource={vi.fn()}
          t={(key) => String(key)}
        />,
      );
    });
    expect(document.body.querySelector('[data-research-agent-frame="active"]')).toBeNull();
  });
});
