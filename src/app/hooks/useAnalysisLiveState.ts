import { useMemo } from "react";
import type { SwarmEvent } from "../../shared/types/app";
import type { AnalysisTaskRun } from "./analysisTypes";
import { extractEventCards } from "./analysisWorkspaceHelpers";

export function useAnalysisLiveState(params: {
  activeRun: AnalysisTaskRun | null;
  events: SwarmEvent[];
  liveRunIds: string[];
  liveStageLabel: string;
}) {
  const { activeRun, events, liveRunIds, liveStageLabel } = params;

  const timelineCards = useMemo(() => {
    if (!activeRun) {
      return [];
    }
    const runIds = Array.isArray(activeRun.eventRunIds) && activeRun.eventRunIds.length > 0
      ? activeRun.eventRunIds
      : activeRun.agentRunId
        ? [activeRun.agentRunId]
        : [];
    return extractEventCards(events, runIds);
  }, [activeRun, events]);

  const liveTimelineCards = useMemo(() => {
    if (liveRunIds.length === 0) {
      return [];
    }
    return extractEventCards(events, liveRunIds).slice(-120);
  }, [events, liveRunIds]);

  const liveOutput = useMemo(() => {
    if (liveRunIds.length === 0) {
      return "";
    }
    const runSet = new Set(liveRunIds);
    const sorted = events
      .filter((event) => runSet.has(event.runId) && event.kind === "responses.output_text.delta")
      .sort((a, b) => a.seq - b.seq);
    let output = "";
    for (const event of sorted) {
      const payload = (event.payload ?? {}) as Record<string, unknown>;
      const chunk = typeof payload.content === "string" ? payload.content : "";
      if (chunk) {
        output += chunk;
      }
    }
    return output.slice(-12_000).trimStart();
  }, [events, liveRunIds]);

  const liveStage = useMemo(() => {
    const explicit = liveStageLabel.trim();
    if (explicit) {
      return explicit;
    }
    if (liveRunIds.length === 0) {
      return "";
    }
    const runSet = new Set(liveRunIds);
    const latest = [...events]
      .reverse()
      .find((event) => runSet.has(event.runId) && event.kind !== "responses.output_text.delta");
    if (!latest) {
      return "";
    }
    const payload = (latest.payload ?? {}) as Record<string, unknown>;
    const stage = typeof payload.stage === "string" ? payload.stage : "";
    const title = typeof payload.title === "string" ? payload.title : "";
    return stage || title || "";
  }, [events, liveRunIds, liveStageLabel]);

  return {
    timelineCards,
    liveTimelineCards,
    liveOutput,
    liveStage,
  };
}
