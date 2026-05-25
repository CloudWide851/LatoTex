import { describe, expect, it } from "vitest";
import type { SwarmEvent } from "../../shared/types/app";
import {
  createEmptyLiveProjection,
  projectAnalysisLiveEvents,
} from "./analysisLiveProjection";

function makeEvent(overrides: Partial<SwarmEvent>): SwarmEvent {
  return {
    seq: 1,
    id: "evt-1",
    runId: "run-1",
    projectId: "project-1",
    role: "analysis.workspace",
    kind: "responses.output_text.delta",
    payload: {},
    createdAt: "2026-04-10T00:00:00.000Z",
    ...overrides,
  };
}

describe("projectAnalysisLiveEvents", () => {
  it("appends live output for the latest run id only", () => {
    const projection = projectAnalysisLiveEvents(createEmptyLiveProjection(), [
      makeEvent({
        runId: "run-1",
        payload: { content: "older " },
      }),
      makeEvent({
        seq: 2,
        id: "evt-2",
        runId: "run-2",
        payload: { content: "newer " },
      }),
      makeEvent({
        seq: 3,
        id: "evt-3",
        runId: "run-2",
        payload: { content: "draft" },
      }),
    ], ["run-1", "run-2"]);

    expect(projection.liveOutput).toBe("newer draft");
  });

  it("keeps timeline cards for all live runs while tracking stage from non-delta events", () => {
    const projection = projectAnalysisLiveEvents(createEmptyLiveProjection(), [
      makeEvent({
        kind: "a2a.task.started",
        payload: {
          stage: "analysis.synthesize",
          source: "workflow",
          status: "running",
          title: "Synthesis",
          content: "",
          cardKey: "synthesis",
        },
      }),
      makeEvent({
        seq: 2,
        id: "evt-2",
        runId: "run-2",
        payload: {
          content: "draft",
          append: true,
          stage: "analysis.synthesize",
          source: "workflow",
          status: "running",
          title: "output",
          cardKey: "output",
        },
      }),
    ], ["run-1", "run-2"]);

    expect(projection.stage).toBe("analysis.synthesize");
    expect(Array.from(projection.cards.values())).toHaveLength(2);
  });

  it("processes new higher-sequence events even when the merged event list length is unchanged", () => {
    const first = projectAnalysisLiveEvents(createEmptyLiveProjection(), [
      makeEvent({
        seq: 10,
        id: "evt-10",
        payload: { content: "first " },
      }),
    ], ["run-1"]);

    const next = projectAnalysisLiveEvents(first, [
      makeEvent({
        seq: 11,
        id: "evt-11",
        payload: { content: "second" },
      }),
    ], ["run-1"]);

    expect(next.liveOutput).toBe("first second");
  });
});
