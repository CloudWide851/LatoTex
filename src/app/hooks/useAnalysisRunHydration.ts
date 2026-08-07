import { useEffect, useMemo, useState } from "react";
import { getEvents } from "../../shared/api/agent";
import { runtimeLogWrite } from "../../shared/api/runtime";
import { readFile } from "../../shared/api/workspace";
import type { SwarmEvent } from "../../shared/types/app";
import type { AnalysisTaskRun } from "./analysisTypes";

export function useAnalysisRunHydration(input: {
  projectId: string | null;
  activeRun: AnalysisTaskRun | null;
  liveRunCount: number;
  events: SwarmEvent[];
}) {
  const { projectId, activeRun, liveRunCount, events } = input;
  const [historicalEvents, setHistoricalEvents] = useState<SwarmEvent[]>([]);
  const [activeRunHtml, setActiveRunHtml] = useState("");

  useEffect(() => {
    if (!activeRun || liveRunCount > 0) {
      setHistoricalEvents([]);
      return;
    }
    const runIds = Array.from(new Set(
      Array.isArray(activeRun.eventRunIds) && activeRun.eventRunIds.length > 0
        ? activeRun.eventRunIds
        : activeRun.agentRunId
          ? [activeRun.agentRunId]
          : [],
    ));
    if (runIds.length === 0) {
      setHistoricalEvents([]);
      return;
    }
    let cancelled = false;
    Promise.all(runIds.map((runId) => getEvents(0, 1000, runId, 0)))
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
            `analysis history hydrate failed: runIds=${runIds.join(",")}, reason=${String(error)}`,
          ).catch(() => undefined);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeRun, liveRunCount]);

  useEffect(() => {
    if (!activeRun) {
      setActiveRunHtml("");
      return;
    }
    if (typeof activeRun.reportHtml === "string" && activeRun.reportHtml.trim().length > 0) {
      setActiveRunHtml(activeRun.reportHtml);
      return;
    }
    if (!projectId || !activeRun.reportRelativePath) {
      setActiveRunHtml("");
      return;
    }
    let cancelled = false;
    readFile(projectId, activeRun.reportRelativePath)
      .then((file) => {
        if (!cancelled) {
          setActiveRunHtml(file.content ?? "");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setActiveRunHtml("");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeRun, projectId]);

  const mergedEvents = useMemo(() => {
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

  return { activeRunHtml, setActiveRunHtml, mergedEvents };
}
