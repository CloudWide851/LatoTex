import { useEffect, useMemo, useRef, useState } from "react";
import type { AnalysisTimelineCard } from "../components/analysis/AnalysisRunTimeline";
import type { SwarmEvent } from "../../shared/types/app";
import type { AnalysisTaskRun } from "./analysisTypes";
import {
  createEmptyLiveProjection,
  projectAnalysisLiveEvents,
  type LiveProjection,
} from "./analysisLiveProjection";
import { extractEventCards } from "./analysisWorkspaceHelpers";

export function useAnalysisLiveState(params: {
  activeRun: AnalysisTaskRun | null;
  events: SwarmEvent[];
  liveRunIds: string[];
  liveStageLabel: string;
}) {
  const { activeRun, events, liveRunIds, liveStageLabel } = params;
  const projectionRef = useRef<LiveProjection>(createEmptyLiveProjection());
  const [liveTimelineCards, setLiveTimelineCards] = useState<AnalysisTimelineCard[]>([]);
  const [liveStage, setLiveStage] = useState("");
  const [liveOutput, setLiveOutput] = useState("");

  const timelineCards = useMemo(() => {
    if (!activeRun || liveRunIds.length > 0) {
      return [];
    }
    const runIds = Array.isArray(activeRun.eventRunIds) && activeRun.eventRunIds.length > 0
      ? activeRun.eventRunIds
      : activeRun.agentRunId
        ? [activeRun.agentRunId]
        : [];
    return extractEventCards(events, runIds);
  }, [activeRun, events, liveRunIds.length]);

  useEffect(() => {
    const explicitStage = liveStageLabel.trim();
    if (liveRunIds.length === 0) {
      projectionRef.current = createEmptyLiveProjection();
      setLiveTimelineCards([]);
      setLiveStage(explicitStage);
      setLiveOutput("");
      return;
    }
    projectionRef.current = projectAnalysisLiveEvents(projectionRef.current, events, liveRunIds);
    const nextStage = explicitStage || projectionRef.current.stage;
    const nextCards = Array.from(projectionRef.current.cards.values())
      .sort((left, right) => left.seq - right.seq)
      .slice(-24)
      .map(({ seq: _seq, ...card }) => card);
    setLiveTimelineCards(nextCards);
    setLiveStage(nextStage);
    setLiveOutput(projectionRef.current.liveOutput);
  }, [events, liveRunIds, liveStageLabel]);

  return {
    timelineCards,
    liveTimelineCards,
    liveOutput,
    liveStage,
  };
}
