import type { SwarmEvent } from "../../shared/types/app";
import type { AnalysisTimelineCard } from "../components/analysis/AnalysisRunTimeline";

type LiveCardEntry = AnalysisTimelineCard & {
  seq: number;
};

export type LiveProjection = {
  runKey: string;
  lastSeq: number;
  cards: Map<string, LiveCardEntry>;
  liveOutput: string;
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

export function createEmptyLiveProjection(): LiveProjection {
  return {
    runKey: "",
    lastSeq: 0,
    cards: new Map(),
    liveOutput: "",
    stage: "",
  };
}

function toArtifactRefs(payload: Record<string, unknown>): string[] {
  if (!Array.isArray(payload.artifactRefs)) {
    return [];
  }
  return payload.artifactRefs
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .slice(0, 8);
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
      phase: typeof payload.phase === "string" ? payload.phase : undefined,
      decision: typeof payload.decision === "string" ? payload.decision : undefined,
      riskLevel: typeof payload.riskLevel === "string" ? payload.riskLevel : undefined,
      nodeId: typeof payload.nodeId === "string" ? payload.nodeId : undefined,
      parentNodeId: typeof payload.parentNodeId === "string" ? payload.parentNodeId : undefined,
      artifactRefs: toArtifactRefs(payload),
      requiresApproval: payload.requiresApproval === true,
      seq: event.seq,
    });
    return;
  }
  existing.seq = event.seq;
  existing.status = typeof payload.status === "string" && payload.status ? payload.status : existing.status;
  existing.title = typeof payload.title === "string" && payload.title ? payload.title : existing.title;
  existing.stage = typeof payload.stage === "string" && payload.stage ? payload.stage : existing.stage;
  existing.source = typeof payload.source === "string" && payload.source ? payload.source : existing.source;
  existing.phase = typeof payload.phase === "string" && payload.phase ? payload.phase : existing.phase;
  existing.decision = typeof payload.decision === "string" && payload.decision ? payload.decision : existing.decision;
  existing.riskLevel = typeof payload.riskLevel === "string" && payload.riskLevel ? payload.riskLevel : existing.riskLevel;
  existing.nodeId = typeof payload.nodeId === "string" && payload.nodeId ? payload.nodeId : existing.nodeId;
  existing.parentNodeId = typeof payload.parentNodeId === "string" && payload.parentNodeId ? payload.parentNodeId : existing.parentNodeId;
  existing.artifactRefs = toArtifactRefs(payload);
  existing.requiresApproval = payload.requiresApproval === true || existing.requiresApproval;
  existing.content = append ? `${existing.content}${content}` : content || existing.content;
}

export function projectAnalysisLiveEvents(
  projection: LiveProjection,
  events: SwarmEvent[],
  liveRunIds: string[],
): LiveProjection {
  const runKey = liveRunIds.join("::");
  const maxIncomingSeq = events.reduce((max, event) => Math.max(max, event.seq), 0);
  const needsReset = projection.runKey !== runKey || maxIncomingSeq < projection.lastSeq;
  const nextProjection = needsReset ? createEmptyLiveProjection() : projection;
  nextProjection.runKey = runKey;
  const runSet = new Set(liveRunIds);
  const liveOutputRunId = liveRunIds[liveRunIds.length - 1] ?? "";
  const pendingEvents = needsReset
    ? events
    : events.filter((event) => event.seq > nextProjection.lastSeq);

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
    if (event.kind === "responses.output_text.delta" && event.runId === liveOutputRunId) {
      const chunk = typeof payload.content === "string" ? payload.content : "";
      if (chunk) {
        nextProjection.liveOutput += chunk;
      }
    }
    if (event.kind === "agent.run.heartbeat") {
      continue;
    }
    const cardKind = toCardKind(event.kind);
    if (cardKind === "a2a" || cardKind === "mcp" || cardKind === "responses" || cardKind === "run") {
      appendLiveCard(nextProjection.cards, event);
    }
  }

  nextProjection.lastSeq = Math.max(nextProjection.lastSeq, maxIncomingSeq);
  return nextProjection;
}
