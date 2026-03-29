import { describe, expect, it } from "vitest";
import type { SwarmEvent } from "../../shared/types/app";
import { extractEventCards } from "./analysisWorkspaceHelpers";

function makeEvent(overrides: Partial<SwarmEvent>): SwarmEvent {
  return {
    seq: 1,
    id: "evt-1",
    runId: "run-1",
    projectId: "project-1",
    role: "latex.overlay",
    kind: "a2a.task.completed",
    payload: {},
    createdAt: "2026-03-29T00:00:00.000Z",
    ...overrides,
  };
}

describe("extractEventCards", () => {
  it("keeps richer trace metadata from event envelopes", () => {
    const cards = extractEventCards([
      makeEvent({
        payload: {
          cardKey: "plan-card",
          stage: "plan.create",
          source: "supervisor",
          status: "success",
          title: "Supervisor Plan",
          content: "workflow=latex.edit",
          phase: "plan",
          decision: "accept",
          riskLevel: "low",
          nodeId: "plan:workflow",
          parentNodeId: "run:accepted",
          artifactRefs: ["file:main.tex"],
          requiresApproval: false,
        },
      }),
    ], ["run-1"]);

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      phase: "plan",
      decision: "accept",
      riskLevel: "low",
      nodeId: "plan:workflow",
      parentNodeId: "run:accepted",
      artifactRefs: ["file:main.tex"],
      requiresApproval: false,
    });
  });

  it("appends streamed response content into the same card", () => {
    const cards = extractEventCards([
      makeEvent({
        seq: 1,
        kind: "responses.output_text.delta",
        payload: {
          cardKey: "resp",
          stage: "main",
          source: "workflow",
          status: "running",
          title: "main · output",
          content: "hello ",
          append: true,
        },
      }),
      makeEvent({
        seq: 2,
        id: "evt-2",
        kind: "responses.output_text.delta",
        payload: {
          cardKey: "resp",
          stage: "main",
          source: "workflow",
          status: "running",
          title: "main · output",
          content: "world",
          append: true,
        },
      }),
    ], ["run-1"]);

    expect(cards).toHaveLength(1);
    expect(cards[0].content).toBe("hello world");
  });
});
