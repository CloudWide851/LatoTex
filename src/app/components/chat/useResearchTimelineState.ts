import { useCallback, useEffect, useRef, useState } from "react";
import {
  getResearchWorkspace,
  listResearchEvidence,
  RESEARCH_RUN_CHANGED_EVENT,
} from "../../../shared/api/researchAgent";
import type { ResearchWorkspaceSnapshot } from "../../../shared/types/researchAgent";
import type { ChatMessage } from "../../hooks/chatSessionStore";

export function useResearchTimelineState(input: {
  projectId: string | null;
  messages: ChatMessage[];
}) {
  const { projectId, messages } = input;
  const [snapshot, setSnapshot] = useState<ResearchWorkspaceSnapshot | null>(null);
  const [evidenceCountByTask, setEvidenceCountByTask] = useState<Record<string, number>>({});
  const requestRef = useRef(0);
  const taskIds = Array.from(new Set(
    messages
      .map((message) => message.taskId)
      .filter((taskId): taskId is string => Boolean(taskId)),
  )).slice(-12);
  const taskKey = taskIds.join("|");

  const refresh = useCallback(async () => {
    if (!projectId || taskIds.length === 0) {
      requestRef.current += 1;
      setSnapshot(null);
      setEvidenceCountByTask({});
      return;
    }
    const request = ++requestRef.current;
    const nextSnapshot = await getResearchWorkspace(projectId);
    const counts = await Promise.all(taskIds.map(async (taskId) => [
      taskId,
      (await listResearchEvidence(projectId, taskId)).length,
    ] as const));
    if (request !== requestRef.current) {
      return;
    }
    setSnapshot(nextSnapshot);
    setEvidenceCountByTask(Object.fromEntries(counts));
  }, [projectId, taskKey]);

  useEffect(() => {
    void refresh().catch(() => undefined);
    if (!projectId || !taskKey || typeof window === "undefined") return;
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string }>).detail;
      if (!detail?.projectId || detail.projectId === projectId) {
        void refresh().catch(() => undefined);
      }
    };
    window.addEventListener("latotex.chat.store.changed", onChanged);
    window.addEventListener(RESEARCH_RUN_CHANGED_EVENT, onChanged);
    return () => {
      requestRef.current += 1;
      window.removeEventListener("latotex.chat.store.changed", onChanged);
      window.removeEventListener(RESEARCH_RUN_CHANGED_EVENT, onChanged);
    };
  }, [projectId, refresh]);

  return { snapshot, evidenceCountByTask };
}
