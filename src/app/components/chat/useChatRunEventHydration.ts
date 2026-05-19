import { useEffect, useMemo, useState } from "react";
import { getEvents } from "../../../shared/api/agent";
import { runtimeLogWrite } from "../../../shared/api/runtime";
import type { SwarmEvent } from "../../../shared/types/app";
import type { ChatMessage } from "../../hooks/chatSessionStore";

const HEARTBEAT_EXCLUDE = ["agent.run.heartbeat"];

export function useChatRunEventHydration(params: {
  messages: ChatMessage[];
  events: SwarmEvent[];
  suspended: boolean;
}): SwarmEvent[] {
  const { messages, events, suspended } = params;
  const [historicalEvents, setHistoricalEvents] = useState<SwarmEvent[]>([]);
  const activeRunIds = useMemo(
    () => Array.from(new Set(
      messages
        .map((message) => message.runId)
        .filter((runId): runId is string => typeof runId === "string" && runId.trim().length > 0),
    )),
    [messages],
  );

  useEffect(() => {
    if (activeRunIds.length === 0 || suspended) {
      setHistoricalEvents([]);
      return;
    }
    let cancelled = false;
    Promise.all(activeRunIds.map((runId) => getEvents(0, 1000, runId, 0, HEARTBEAT_EXCLUDE)))
      .then((batches) => {
        if (!cancelled) {
          setHistoricalEvents(batches.flatMap((batch) => batch.events ?? []));
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setHistoricalEvents([]);
          void runtimeLogWrite(
            "WARN",
            `chat history hydrate failed: runIds=${activeRunIds.join(",")}, reason=${String(error)}`,
          ).catch(() => undefined);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeRunIds, suspended]);

  return useMemo(() => {
    if (historicalEvents.length === 0) {
      return events;
    }
    const byId = new Map<string, SwarmEvent>();
    for (const event of historicalEvents) {
      byId.set(event.id, event);
    }
    for (const event of events) {
      byId.set(event.id, event);
    }
    return Array.from(byId.values()).sort((left, right) => left.seq - right.seq);
  }, [events, historicalEvents]);
}
