import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  listResearchPlanApprovals,
  listResearchResourceLocks,
  listResearchRuns,
  listResearchUiCommands,
  getResearchWorkspace,
  pauseResearchRun,
  resumeResearchRun,
  cancelResearchRun,
  RESEARCH_RUN_CHANGED_EVENT,
  resolveResearchUiCommand,
  resolveResearchPlanApproval,
} from "../../shared/api/researchAgent";
import type {
  AgentResourceLock,
  ResearchAgentRun,
  ResearchPlanApproval,
  ResearchUiCommand,
} from "../../shared/types/researchAgent";
import {
  dispatchResearchUiCommand,
  type ResearchUiCommandContext,
} from "./researchUiCommandDispatcher";

export { dispatchResearchUiCommand } from "./researchUiCommandDispatcher";

const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled"]);
export function researchRunRecoveryCandidates(
  runs: ResearchAgentRun[],
  attemptedRunIds: ReadonlySet<string>,
): ResearchAgentRun[] {
  return runs.filter((run) => run.status === "running" && !attemptedRunIds.has(run.runId));
}

function diagnosticCode(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error ?? "");
  return /^research\.[a-z0-9_.-]+$/i.test(value)
    ? value
    : "research.ui_command.execution_failed";
}

export function useResearchAgentRuntime(context: ResearchUiCommandContext) {
  const { projectId } = context;
  const [runs, setRuns] = useState<ResearchAgentRun[]>([]);
  const [approvals, setApprovals] = useState<ResearchPlanApproval[]>([]);
  const [uiCommands, setUiCommands] = useState<ResearchUiCommand[]>([]);
  const [locks, setLocks] = useState<AgentResourceLock[]>([]);
  const [taskGoals, setTaskGoals] = useState<Record<string, string>>({});
  const refreshTokenRef = useRef(0);
  const taskGoalsTokenRef = useRef(0);
  const executingCommandRef = useRef<string | null>(null);
  const recoveryAttemptedRef = useRef(new Set<string>());
  const contextRef = useRef(context);
  const pendingResolutionRef = useRef(new Map<string, {
    status: "completed" | "failed";
    result?: unknown;
    diagnosticCode?: string;
  }>());
  contextRef.current = context;

  const refresh = useCallback(async () => {
    if (!projectId) {
      refreshTokenRef.current += 1;
      setRuns([]);
      setApprovals([]);
      setUiCommands([]);
      setLocks([]);
      setTaskGoals({});
      return;
    }
    const token = ++refreshTokenRef.current;
    const [nextRuns, nextApprovals, nextUiCommands, nextLocks] = await Promise.all([
      listResearchRuns(projectId, false),
      listResearchPlanApprovals(projectId),
      listResearchUiCommands(projectId),
      listResearchResourceLocks(projectId),
    ]);
    if (token !== refreshTokenRef.current) {
      return;
    }
    setRuns(nextRuns);
    setApprovals(nextApprovals.filter((approval) => approval.status === "pending"));
    setUiCommands(nextUiCommands);
    setLocks(nextLocks);
  }, [projectId]);

  const refreshTaskGoals = useCallback(async () => {
    if (!projectId) {
      taskGoalsTokenRef.current += 1;
      setTaskGoals({});
      return;
    }
    const token = ++taskGoalsTokenRef.current;
    const snapshot = await getResearchWorkspace(projectId);
    if (token !== taskGoalsTokenRef.current) {
      return;
    }
    setTaskGoals(Object.fromEntries(snapshot.tasks.map((task) => [task.id, task.goal])));
  }, [projectId]);

  useEffect(() => {
    recoveryAttemptedRef.current.clear();
    setRuns([]);
    setApprovals([]);
    setUiCommands([]);
    setLocks([]);
    void refresh().catch(() => undefined);
    void refreshTaskGoals().catch(() => undefined);
  }, [refresh, refreshTaskGoals]);

  useEffect(() => {
    if (!projectId) {
      return;
    }
    for (const run of researchRunRecoveryCandidates(runs, recoveryAttemptedRef.current)) {
      recoveryAttemptedRef.current.add(run.runId);
      void resumeResearchRun(projectId, run.runId)
        .then(() => refresh())
        .catch(() => undefined);
    }
  }, [projectId, refresh, runs]);

  useEffect(() => {
    const handleRunChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string }>).detail;
      if (projectId && (!detail?.projectId || detail.projectId === projectId)) {
        void refresh().catch(() => undefined);
        void refreshTaskGoals().catch(() => undefined);
      }
    };
    window.addEventListener(RESEARCH_RUN_CHANGED_EVENT, handleRunChanged);
    return () => window.removeEventListener(RESEARCH_RUN_CHANGED_EVENT, handleRunChanged);
  }, [projectId, refresh, refreshTaskGoals]);

  const activeRuns = useMemo(
    () => runs.filter((run) => !TERMINAL_RUN_STATUSES.has(run.status)),
    [runs],
  );

  useEffect(() => {
    if (activeRuns.length === 0) {
      return;
    }
    const timer = window.setInterval(() => {
      void refresh().catch(() => undefined);
    }, 1_200);
    return () => window.clearInterval(timer);
  }, [activeRuns.length, refresh]);

  useEffect(() => {
    const command = uiCommands[0];
    if (!command) {
      return;
    }
    const key = `${command.runId}:${command.stepId}`;
    if (executingCommandRef.current === key) {
      return;
    }
    executingCommandRef.current = key;
    const resolvePending = async () => {
      let resolution = pendingResolutionRef.current.get(key);
      if (!resolution) {
        try {
          const result = await dispatchResearchUiCommand(command.command, contextRef.current);
          resolution = { status: "completed", result };
        } catch (error) {
          resolution = { status: "failed", diagnosticCode: diagnosticCode(error) };
        }
        pendingResolutionRef.current.set(key, resolution);
      }
      await resolveResearchUiCommand({
        projectId: command.projectId,
        runId: command.runId,
        stepId: command.stepId,
        ...resolution,
      });
      pendingResolutionRef.current.delete(key);
    };
    void resolvePending()
      .catch(() => undefined)
      .finally(() => {
        executingCommandRef.current = null;
        void refresh().catch(() => undefined);
      });
  }, [refresh, uiCommands]);

  const primaryRun: ResearchAgentRun | null = activeRuns.length > 0 ? activeRuns[0] : null;
  const pauseRun = useCallback(async (runId: string) => {
    if (!projectId) return;
    await pauseResearchRun(projectId, runId);
    await refresh();
  }, [projectId, refresh]);
  const resumeRun = useCallback(async (runId: string) => {
    if (!projectId) return;
    await resumeResearchRun(projectId, runId);
    await refresh();
  }, [projectId, refresh]);
  const cancelRun = useCallback(async (runId: string) => {
    if (!projectId) return;
    await cancelResearchRun(projectId, runId);
    await refresh();
  }, [projectId, refresh]);
  const resolveApproval = useCallback(async (
    approvalId: string,
    decision: "approved" | "rejected",
  ) => {
    if (!projectId) return;
    await resolveResearchPlanApproval(projectId, approvalId, decision);
    await refresh();
  }, [projectId, refresh]);

  return {
    activeRuns,
    approvals,
    locks,
    primaryRun,
    primaryTaskGoal: primaryRun ? (taskGoals[primaryRun.taskId] ?? "") : "",
    pauseRun,
    resumeRun,
    cancelRun,
    resolveApproval,
    refresh,
  };
}

export type ResearchAgentRuntimeProjection = ReturnType<typeof useResearchAgentRuntime>;
