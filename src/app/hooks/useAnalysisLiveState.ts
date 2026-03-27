import { useEffect, useMemo, useRef, useState } from "react";
import type { AnalysisTimelineCard } from "../components/analysis/AnalysisRunTimeline";
import type { SwarmEvent } from "../../shared/types/app";
import type { AnalysisTaskRun } from "./analysisTypes";
import { extractEventCards } from "./analysisWorkspaceHelpers";

type LiveCardEntry = AnalysisTimelineCard & {
  seq: number;
};

type LiveProjection = {
  runKey: string;
  processedCount: number;
  cards: Map<string, LiveCardEntry>;
  stage: string;
};

function toCardKind(kind: string): string {
  if (kind.startsWith("a2a.")) {
    return "a2a";
  }
  if (kind.startsWith("mcp.")) {
    return "mcp";
  }
  if (kind.startsWith("responses.")) {
    return "responses";
  }
  if (kind.startsWith("agent.run")) {
    return "run";
  }
  return "other";
}

function createEmptyProjection(): LiveProjection {
  return {
    runKey: "",
    processedCount: 0,
    cards: new Map(),
    stage: "",
  };
}

function appendLiveCard(cards: Map<string, LiveCardEntry>, event: SwarmEvent): void {
  const payload = event.payload ?? {};
  const cardKey =
    typeof payload.cardKey === "string" && payload.cardKey.trim().length > 0
      ? `${event.runId}:${payload.cardKey}`
      : `${event.runId}:${event.id}`;
  const append = payload.append === true;
  const content =
    typeof payload.content === "string"
      ? payload.content
      : typeof payload.output === "string"
        ? payload.output
        : "";
  const existing = cards.get(cardKey);
  if (!existing) {
    cards.set(cardKey, {
      id: event.id,
      runId: event.runId,
      stage: typeof payload.stage === "string" ? payload.stage : "run",
      source: typeof payload.source === "string" ? payload.source : event.role,
      status: typeof payload.status === "string" ? payload.status : "running",
      title: typeof payload.title === "string" ? payload.title : event.kind,
      content,
      createdAt: event.createdAt,
      seq: event.seq,
    });
    return;
  }
  existing.seq = event.seq;
  existing.status = typeof payload.status === "string" && payload.status ? payload.status : existing.status;
  existing.title = typeof payload.title === "string" && payload.title ? payload.title : existing.title;
  existing.stage = typeof payload.stage === "string" && payload.stage ? payload.stage : existing.stage;
  existing.source = typeof payload.source === "string" && payload.source ? payload.source : existing.source;
  existing.content = append ? `${existing.content}${content}` : content || existing.content;
}

function projectLiveEvents(
  projection: LiveProjection,
  events: SwarmEvent[],
  liveRunIds: string[],
): LiveProjection {
  const runKey = liveRunIds.join("::");
  const needsReset = projection.runKey !== runKey || events.length < projection.processedCount;
  const nextProjection = needsReset ? createEmptyProjection() : projection;
  nextProjection.runKey = runKey;
  const runSet = new Set(liveRunIds);
  const pendingEvents = needsReset ? events : events.slice(nextProjection.processedCount);

  for (const event of pendingEvents) {
    if (!runSet.has(event.runId)) {
      continue;
    }
    const payload = event.payload ?? {};
    const stage = typeof payload.stage === "string" ? payload.stage.trim() : "";
    const title = typeof payload.title === "string" ? payload.title.trim() : "";
    if (event.kind !== "responses.output_text.delta" && event.kind !== "agent.run.heartbeat") {
      nextProjection.stage = stage || title || nextProjection.stage;
    }
    if (event.kind === "agent.run.heartbeat") {
      continue;
    }
    const cardKind = toCardKind(event.kind);
    if (cardKind === "a2a" || cardKind === "mcp" || cardKind === "responses" || cardKind === "run") {
      appendLiveCard(nextProjection.cards, event);
    }
  }

  nextProjection.processedCount = events.length;
  return nextProjection;
}

export function useAnalysisLiveState(params: {
  activeRun: AnalysisTaskRun | null;
  events: SwarmEvent[];
  liveRunIds: string[];
  liveStageLabel: string;
}) {
  const { activeRun, events, liveRunIds, liveStageLabel } = params;
  const projectionRef = useRef<LiveProjection>(createEmptyProjection());
  const [liveTimelineCards, setLiveTimelineCards] = useState<AnalysisTimelineCard[]>([]);
  const [liveStage, setLiveStage] = useState("");

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
    if (liveRunIds.length === 0) {
      projectionRef.current = createEmptyProjection();
      setLiveTimelineCards([]);
      setLiveStage("");
      return;
    }
    projectionRef.current = projectLiveEvents(projectionRef.current, events, liveRunIds);
    const explicitStage = liveStageLabel.trim();
    const nextStage = explicitStage || projectionRef.current.stage;
    const nextCards = Array.from(projectionRef.current.cards.values())
      .sort((left, right) => left.seq - right.seq)
      .slice(-3)
      .map(({ seq: _seq, ...card }) => card);
    setLiveTimelineCards(nextCards);
    setLiveStage(nextStage);
  }, [events, liveRunIds, liveStageLabel]);

  return {
    timelineCards,
    liveTimelineCards,
    liveOutput: "",
    liveStage,
  };
}
