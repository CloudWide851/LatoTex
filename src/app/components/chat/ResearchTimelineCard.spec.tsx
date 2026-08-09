// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ResearchPlanVersion, ResearchTask } from "../../../shared/types/researchAgent";
import { ResearchTimelineCard } from "./ResearchTimelineCard";

const TASK: ResearchTask = {
  id: "task-1",
  projectId: "project-1",
  goal: "Verify the primary outcome",
  status: "plan_pending",
  currentPlanVersion: 2,
  runIds: [],
  chatSessionId: "chat-1",
  createdAt: "2026-08-10T00:00:00Z",
  updatedAt: "2026-08-10T00:00:00Z",
};

const PLAN: ResearchPlanVersion = {
  id: "plan-2",
  taskId: "task-1",
  version: 2,
  sourceMessage: "Verify the primary outcome",
  approvalStatus: "draft",
  authorizedProjectIds: ["project-1"],
  title: "Evidence and analysis plan",
  summary: "Find evidence and run the approved model.",
  assumptions: [],
  expectedArtifacts: ["Evidence ledger", "Analysis report"],
  acceptanceCriteria: ["Every claim has a source"],
  steps: [{
    id: "step-1",
    order: 0,
    enabled: true,
    dependencies: [],
    capability: "analysis.run",
    input: { spec: { methodFamily: "linear_regression" } },
    riskLevel: "read",
    status: "pending",
    runId: null,
  }],
  createdAt: "2026-08-10T00:00:00Z",
  approvedAt: null,
};

describe("ResearchTimelineCard", () => {
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
    container.remove();
  });

  it("renders the version, evidence count, analysis spec, outputs, and acceptance checks", async () => {
    await act(async () => {
      root.render(<ResearchTimelineCard task={TASK} plan={PLAN} evidenceCount={3} t={(key) => String(key)} />);
    });

    expect(container.textContent).toContain("v2");
    expect(container.textContent).toContain("3 research.timeline.evidence");
    expect(container.textContent).toContain("research.timeline.analysisSpec");
    expect(container.textContent).toContain("Evidence ledger · Analysis report");
    expect(container.textContent).toContain("Every claim has a source");
  });
});
