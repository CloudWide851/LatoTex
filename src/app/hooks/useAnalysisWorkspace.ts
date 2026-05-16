import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentTeamMode } from "../../shared/types/app";
import { executeWorkflowCancel, getEvents } from "../../shared/api/agent";
import { runtimeLogWrite } from "../../shared/api/runtime";
import { readFile } from "../../shared/api/workspace";
import { listCandidateDataFiles } from "./analysisDataSources";
import { appendPromptRefs, resolveDroppedPromptRefs } from "./analysisDropRefs";
import { applyPromptRefSuggestion } from "./analysisPromptRefs";
import { loadAnalysisTaskState, saveAnalysisTaskState } from "./analysisTaskStore";
import { createAnalysisTask, deleteTaskFromList, renameTaskList, updateTaskListById } from "./analysisTaskActions";
import { ensureAnalysisTasksLoaded } from "./analysisRunHelpers";
import type { AnalysisSourceType, AnalysisTask } from "./analysisTypes";
import { nowIso } from "./analysisTypes";
import { loadAnalysisStageCache, saveAnalysisStageCache, writeCachedAnalysisStageValue, type AnalysisStageCacheStore } from "./analysisStageCache";
import { upsertRun } from "./analysisWorkspaceHelpers";
import { exportAnalysisArtifact, revealAnalysisArtifact, runPaperAnalysisTask } from "./analysisWorkspaceActions";
import type { UseAnalysisWorkspaceParams } from "./useAnalysisWorkspace.types";
import { useAnalysisLiveState } from "./useAnalysisLiveState";
import { runAnalysisWorkspacePrompt } from "./analysisWorkspaceRunner";

export function useAnalysisWorkspace(params: UseAnalysisWorkspaceParams) {
  const {
    projectId,
    selectedFile,
    editorContent,
    fileList,
    locale,
    analysisModelOverride,
    suspended = false,
    events,
    setToast,
    t,
  } = params;
  const [running, setRunning] = useState(false);
  const [tasks, setTasks] = useState<AnalysisTask[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeRunHtml, setActiveRunHtml] = useState("");
  const [historicalEvents, setHistoricalEvents] = useState<typeof events>([]);
  const [liveRunIds, setLiveRunIds] = useState<string[]>([]);
  const [liveStageLabel, setLiveStageLabel] = useState("");
  const loadedRef = useRef(false);
  const tasksRef = useRef<AnalysisTask[]>([]);
  const stageCacheRef = useRef<AnalysisStageCacheStore | null>(null);
  const stageCacheProjectIdRef = useRef<string | null>(null);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runInFlightRef = useRef(false);
  const liveTaskIdRef = useRef<string | null>(null);
  const liveTaskRunIdRef = useRef<string | null>(null);
  const candidateFiles = useMemo(() => listCandidateDataFiles(fileList), [fileList]);
  const csvCandidateFiles = useMemo(
    () => candidateFiles.filter((path) => /\.(csv|tsv)$/i.test(path)),
    [candidateFiles],
  );
  const activeTask = useMemo(
    () => tasks.find((item) => item.id === activeTaskId) ?? null,
    [activeTaskId, tasks],
  );
  const activeRun = useMemo(() => {
    if (!activeTask) {
      return null;
    }
    const activeRunId = typeof activeTask.activeRunId === "string" ? activeTask.activeRunId.trim() : "";
    if (activeRunId) {
      const matched = activeTask.runs.find((item) => item.id === activeRunId);
      if (matched) {
        return matched;
      }
    }
    return activeTask.runs[0] ?? null;
  }, [activeTask]);
  const prompt = activeTask?.draftPrompt ?? "";
  const analysisError = activeTask?.lastError ?? null;
  const mergedAnalysisEvents = useMemo(() => {
    if (historicalEvents.length === 0) {
      return events;
    }
    const byId = new Map<string, typeof events[number]>();
    for (const event of historicalEvents) {
      byId.set(event.id, event);
    }
    for (const event of events) {
      byId.set(event.id, event);
    }
    return Array.from(byId.values()).sort((left, right) => left.seq - right.seq);
  }, [events, historicalEvents]);
  const {
    timelineCards,
    liveTimelineCards,
    liveOutput,
    liveStage,
  } = useAnalysisLiveState({
    activeRun,
    events: mergedAnalysisEvents,
    liveRunIds,
    liveStageLabel,
  });
  useEffect(() => {
    if (!activeRun || liveRunIds.length > 0) {
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
        if (cancelled) {
          return;
        }
        const hydrated = batches.flatMap((batch) => batch.events ?? []);
        setHistoricalEvents(hydrated);
      })
      .catch((error) => {
        if (!cancelled) {
          setHistoricalEvents([]);
          void runtimeLogWrite("WARN", `analysis history hydrate failed: runIds=${runIds.join(",")}, reason=${String(error)}`).catch(() => undefined);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeRun, liveRunIds.length]);
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
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);
  useEffect(() => {
    if (stageCacheProjectIdRef.current !== projectId) {
      stageCacheProjectIdRef.current = projectId;
      stageCacheRef.current = null;
    }
  }, [projectId]);
  useEffect(() => {
    if (!projectId) {
      setTasks([]);
      setActiveTaskId(null);
      loadedRef.current = false;
      return;
    }
    let cancelled = false;
    loadAnalysisTaskState(projectId)
      .then((state) => {
        if (cancelled) {
          return;
        }
        setTasks(state.tasks);
        setActiveTaskId(state.activeTaskId);
        loadedRef.current = true;
      })
      .catch((error) => {
        if (!cancelled) {
          setToast({ type: "error", message: String(error) });
          setTasks([]);
          setActiveTaskId(null);
          loadedRef.current = true;
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, setToast, t]);
  useEffect(() => {
    if (tasks.length === 0) {
      if (activeTaskId !== null) {
        setActiveTaskId(null);
      }
      return;
    }
    if (!activeTaskId || !tasks.some((item) => item.id === activeTaskId)) {
      setActiveTaskId(tasks[0].id);
    }
  }, [activeTaskId, tasks]);
  useEffect(() => {
    if (!projectId || !loadedRef.current) {
      return;
    }
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
    }
    persistTimerRef.current = setTimeout(() => {
      void saveAnalysisTaskState(projectId, {
        version: 1,
        activeTaskId,
        tasks,
      }).catch((error) => setToast({ type: "error", message: String(error) }));
    }, 180);
    return () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
    };
  }, [activeTaskId, projectId, setToast, tasks]);
  const canRun = useMemo(() => Boolean(!suspended && projectId && activeTask && prompt.trim()), [activeTask, projectId, prompt, suspended]);
  useEffect(() => {
    if (!suspended || liveRunIds.length === 0) {
      return;
    }
    const runIds = Array.from(new Set(liveRunIds));
    for (const runId of runIds) {
      void executeWorkflowCancel(runId).catch(() => undefined);
    }
  }, [liveRunIds, suspended]);
  const updateTaskById = useCallback((taskId: string, updater: (task: AnalysisTask) => AnalysisTask) => {
    setTasks((prev) => updateTaskListById(prev, taskId, updater));
  }, []);
  useEffect(() => {
    const taskId = liveTaskIdRef.current;
    const runId = liveTaskRunIdRef.current;
    if (!running || !taskId || !runId) {
      return;
    }
    updateTaskById(taskId, (task) => {
      const existing = task.runs.find((item) => item.id === runId);
      if (!existing) {
        return task;
      }
      const nextDraft = liveOutput || existing.draftOutputText || "";
      const nextStage = liveStage || existing.liveStageLabel || "";
      if (
        existing.status === "running"
        && existing.draftOutputText === nextDraft
        && existing.liveStageLabel === nextStage
      ) {
        return task;
      }
      return upsertRun(task, {
        ...existing,
        status: "running",
        draftOutputText: nextDraft,
        liveStageLabel: nextStage,
        updatedAt: nowIso(),
      });
    });
  }, [liveOutput, liveStage, running, updateTaskById]);
  const onDropPromptPaths = useCallback((paths: string[]) => {
    const resolvedPaths = resolveDroppedPromptRefs(paths, candidateFiles);
    if (resolvedPaths.length === 0) {
      return;
    }
    let targetTaskId = activeTaskId;
    if (!targetTaskId) {
      targetTaskId = tasksRef.current[0]?.id ?? null;
    }
    if (!targetTaskId) {
      const task = createAnalysisTask({
        defaultName: t("analysis.defaultTaskName"),
        sourceType: "data",
      });
      setTasks((prev) => [task, ...prev]);
      setActiveTaskId(task.id);
      targetTaskId = task.id;
    }
    updateTaskById(targetTaskId, (task) => ({
      ...task,
      draftPrompt: appendPromptRefs(task.draftPrompt ?? "", resolvedPaths, applyPromptRefSuggestion),
      updatedAt: nowIso(),
    }));
  }, [activeTaskId, candidateFiles, t, updateTaskById]);
  const setPrompt = useCallback((value: string) => {
    if (!activeTaskId) {
      return;
    }
    updateTaskById(activeTaskId, (task) => ({
      ...task,
      draftPrompt: value,
      updatedAt: nowIso(),
    }));
  }, [activeTaskId, updateTaskById]);
  const setActiveRunForTask = useCallback((taskId: string, runId: string) => {
    setTasks((prev) => prev.map((item) => (item.id === taskId ? { ...item, activeRunId: runId, updatedAt: nowIso() } : item)));
  }, []);
  const createTask = useCallback((sourceType: AnalysisSourceType = "data", sourcePath?: string, name?: string) => {
    const task = createAnalysisTask({
      defaultName: t("analysis.defaultTaskName"),
      sourceType,
      sourcePath,
      name,
    });
    setTasks((prev) => [task, ...prev]);
    setActiveTaskId(task.id);
    return task;
  }, [t]);
  const renameTask = useCallback((taskId: string, name: string) => {
    setTasks((prev) => renameTaskList(prev, taskId, name));
  }, []);
  const deleteTask = useCallback((taskId: string) => {
    setTasks((prev) => {
      const nextState = deleteTaskFromList({
        tasks: prev,
        taskId,
        activeTaskId,
      });
      setActiveTaskId(nextState.nextActiveTaskId);
      return nextState.tasks;
    });
  }, [activeTaskId]);
  const ensureTasksReady = useCallback(async () => ensureAnalysisTasksLoaded(loadedRef), []);
  const ensureStageCache = useCallback(async () => {
    if (!projectId) {
      return { version: 1, entries: {} } as AnalysisStageCacheStore;
    }
    if (!stageCacheRef.current || stageCacheProjectIdRef.current !== projectId) {
      stageCacheRef.current = await loadAnalysisStageCache(projectId);
      stageCacheProjectIdRef.current = projectId;
    }
    return stageCacheRef.current;
  }, [projectId]);
  const persistStageCacheEntry = useCallback(async (key: string, value: unknown) => {
    if (!projectId) {
      return;
    }
    const store = await ensureStageCache();
    const nextStore = writeCachedAnalysisStageValue(store, key, value);
    stageCacheRef.current = nextStore;
    await saveAnalysisStageCache(projectId, nextStore);
  }, [ensureStageCache, projectId]);
  const runAnalysisForPrompt = useCallback(async (
    inputPrompt: string,
    options?: {
      forcedTaskId?: string;
      taskSnapshot?: AnalysisTask;
      savePrompt?: boolean;
      teamMode?: AgentTeamMode;
    },
  ) => {
    await runAnalysisWorkspacePrompt({
      inputPrompt,
      options,
      suspended,
      projectId,
      activeTaskId,
      selectedFile,
      editorContent,
      candidateFiles,
      csvCandidateFiles,
      locale,
      analysisModelOverride,
      liveOutput,
      tasksRef,
      loadedRef,
      runInFlightRef,
      liveTaskIdRef,
      liveTaskRunIdRef,
      ensureStageCache,
      persistStageCacheEntry,
      updateTaskById,
      setActiveTaskId,
      setActiveRunHtml,
      setLiveRunIds,
      setLiveStageLabel,
      setRunning,
      setToast,
      t,
    });
  }, [
    activeTaskId,
    analysisModelOverride,
    candidateFiles,
    csvCandidateFiles,
    editorContent,
    ensureStageCache,
    locale,
    liveOutput,
    persistStageCacheEntry,
    projectId,
    selectedFile,
    setToast,
    suspended,
    t,
    updateTaskById,
  ]);
  const runAnalysis = useCallback(async (teamMode: AgentTeamMode = "auto") => {
    await runAnalysisForPrompt(prompt, { teamMode });
  }, [prompt, runAnalysisForPrompt]);
  const runAnalysisWithPrompt = useCallback(
    async (inputPrompt: string) => {
      setPrompt(inputPrompt);
      await runAnalysisForPrompt(inputPrompt);
    },
    [runAnalysisForPrompt, setPrompt],
  );
  const runPaperAnalysisFromLibrary = useCallback(async (sourcePath: string) => {
    await runPaperAnalysisTask({
      sourcePath,
      ensureTasksReady,
      runInFlightRef,
      setToast,
      t,
      tasksRef,
      createTask,
      setActiveTaskId,
      updateTaskById,
      runAnalysisForPrompt,
    });
  }, [createTask, ensureTasksReady, runAnalysisForPrompt, setToast, t, updateTaskById]);
  const exportArtifact = useCallback(async (relativePath: string) => {
    try {
      await exportAnalysisArtifact(projectId, relativePath);
    } catch (error) {
      setToast({ type: "error", message: String(error) });
    }
  }, [projectId, setToast]);
  const revealArtifact = useCallback(async (relativePath: string) => {
    try {
      await revealAnalysisArtifact(projectId, relativePath);
    } catch (error) {
      setToast({ type: "error", message: String(error) });
    }
  }, [projectId, setToast]);
  return { prompt, setPrompt, onDropPromptPaths, running, canRun, analysisError, tasks, activeTaskId, activeTask, activeRun, activeRunHtml, timelineCards, liveTimelineCards, liveOutput, liveStage, candidateFiles, setActiveTaskId, setActiveRunForTask, createTask, renameTask, deleteTask, runAnalysis, runAnalysisWithPrompt, runPaperAnalysisFromLibrary, exportArtifact, revealArtifact };
}
