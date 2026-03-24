import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { analysisSaveReport } from "../../shared/api/analysis";
import { executeWorkflowCancel } from "../../shared/api/agent";
import { runtimeLogWrite } from "../../shared/api/runtime";
import { readFile } from "../../shared/api/workspace";
import {
  buildPaperAnalysisContext,
  listCandidateDataFiles,
  loadDataSnapshots,
  type AnalysisSourceSnapshot,
} from "./analysisDataSources";
import { languageLabel, resolveAnalysisLanguage } from "./analysisLanguage";
import { appendPromptRefs, resolveDroppedPromptRefs } from "./analysisDropRefs";
import { applyPromptRefSuggestion, resolvePromptInputFiles } from "./analysisPromptRefs";
import { buildPyodideAnalysisProfile } from "../../features/analysis/pyodide/profile";
import { loadAnalysisTaskState, saveAnalysisTaskState } from "./analysisTaskStore";
import { createAnalysisTask, deleteTaskFromList, renameTaskList, updateTaskListById } from "./analysisTaskActions";
import { ensureAnalysisTasksLoaded, isRetryableAnalysisProviderError, runRolePromptWithAgent } from "./analysisRunHelpers";
import type { AnalysisSourceType, AnalysisTask, AnalysisTaskRun } from "./analysisTypes";
import { nowIso } from "./analysisTypes";
import {
  parsePayloadJson,
  summarizeSnapshotsForPrompt,
  upsertRun,
} from "./analysisWorkspaceHelpers";
import { exportAnalysisArtifact, revealAnalysisArtifact, runPaperAnalysisTask } from "./analysisWorkspaceActions";
import type { UseAnalysisWorkspaceParams } from "./useAnalysisWorkspace.types";
import { useAnalysisLiveState } from "./useAnalysisLiveState";
import {
  buildAnalysisJsonRepairPrompt,
  buildAnalysisSynthesisPrompt,
  buildCondensedPaperSourceBlock,
  buildFallbackPaperSourceBlock,
  buildPaperCondensePrompt,
  buildPaperSourceBlock,
  shouldCondensePaperSource,
  summarizePaperChunks,
} from "./analysisPaperSynthesis";
import {
  buildCompletedAnalysisRun,
  hasStructuredAnalysisOutput,
} from "./analysisWorkspaceRunResult";
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
  const [liveRunIds, setLiveRunIds] = useState<string[]>([]);
  const [liveStageLabel, setLiveStageLabel] = useState("");
  const loadedRef = useRef(false);
  const tasksRef = useRef<AnalysisTask[]>([]);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runInFlightRef = useRef(false);
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
    if (activeTask.activeRunId) {
      return activeTask.runs.find((item) => item.id === activeTask.activeRunId) ?? activeTask.runs[0] ?? null;
    }
    return activeTask.runs[0] ?? null;
  }, [activeTask]);
  const prompt = activeTask?.draftPrompt ?? "";
  const analysisError = activeTask?.lastError ?? null;
  const {
    timelineCards,
    liveTimelineCards,
    liveOutput,
    liveStage,
  } = useAnalysisLiveState({
    activeRun,
    events,
    liveRunIds,
    liveStageLabel,
  });
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
  const runAnalysisForPrompt = useCallback(async (
    inputPrompt: string,
    options?: {
      forcedTaskId?: string;
      taskSnapshot?: AnalysisTask;
      savePrompt?: boolean;
    },
  ) => {
    const normalizedPrompt = inputPrompt.trim();
    if (suspended) {
      setToast({ type: "info", message: t("sleep.title") });
      return;
    }
    if (runInFlightRef.current) {
      setToast({ type: "info", message: t("analysis.running") });
      return;
    }
    if (!projectId) {
      setToast({ type: "error", message: t("analysis.error.noProject") });
      return;
    }
    await ensureTasksReady();
    const targetTaskId = options?.forcedTaskId ?? activeTaskId;
    const task = options?.taskSnapshot ?? tasksRef.current.find((item) => item.id === targetTaskId) ?? null;
    if (!task) {
      setToast({ type: "error", message: t("analysis.error.noTask") });
      return;
    }
    if (!normalizedPrompt) {
      updateTaskById(task.id, (item) => ({
        ...item,
        lastError: t("analysis.error.emptyPrompt"),
        updatedAt: nowIso(),
      }));
      return;
    }
    runInFlightRef.current = true;
    updateTaskById(task.id, (item) => ({
      ...item,
      draftPrompt: "",
      lastError: null,
      updatedAt: nowIso(),
    }));
    setRunning(true);
    setLiveRunIds([]);
    setLiveStageLabel("");
    let currentStage = t("analysis.step.agentSynthesis");
    try {
      const setStage = (label: string) => {
        currentStage = label;
        setLiveStageLabel(label);
      };
      const runIds: string[] = [];
      const runRolePromptWithTrace = async (
        workflowId: string,
        promptText: string,
        contextRefs: string[],
        bypassCache = false,
      ) => {
        const result = await runRolePromptWithAgent({
          projectId,
          workflowId,
          promptText,
          contextRefs,
          modelOverride: analysisModelOverride ?? undefined,
          bypassCache,
        });
        runIds.push(result.runId);
        setLiveRunIds((prev) => (prev.includes(result.runId) ? prev : [...prev, result.runId]));
        return result;
      };
      const outputLanguage = resolveAnalysisLanguage(normalizedPrompt, locale);
      const outputLanguageLabel = languageLabel(outputLanguage);
      const contextRefs: string[] = [];
      if (selectedFile) {
        contextRefs.push(`file:${selectedFile}`);
      }
      let snapshots: AnalysisSourceSnapshot[] = [];
      let sourceBlock = "";
      let synthesisFallbackSourceBlock: string | null = null;
      let resolvedInputFiles: string[] = [];
      const steps: string[] = [];
      if (task.sourceType === "paper" && task.sourcePath) {
        setStage(t("analysis.step.paperExtract"));
        steps.push(currentStage);
        const paperContext = await buildPaperAnalysisContext(projectId, task.sourcePath);
        const { chunkSummaries, chunkFailures } = await summarizePaperChunks({
          chunks: paperContext.chunks,
          outputLanguageLabel,
          runChunkPrompt: (promptText) =>
            runRolePromptWithTrace("analysis.explore_chunk", promptText, contextRefs).then((result) => result.output),
          onChunkFailure: async (chunk, reason) => {
            await runtimeLogWrite(
              "WARN",
              `analysis paper chunk failed: path=${task.sourcePath}, chunk=${chunk.chunkIndex + 1}, reason=${reason}`,
            ).catch(() => undefined);
          },
        });
        if (paperContext.chunks.length > 0 && chunkSummaries.length === 0) {
          throw new Error(`analysis.paper.chunk_failed_all(${chunkFailures})`);
        }
        const rawPaperSourceBlock = buildPaperSourceBlock(paperContext, chunkSummaries);
        sourceBlock = rawPaperSourceBlock;
        synthesisFallbackSourceBlock = buildFallbackPaperSourceBlock(rawPaperSourceBlock);
        if (shouldCondensePaperSource(rawPaperSourceBlock, paperContext.chunks.length)) {
          setStage(t("analysis.step.crossFile"));
          steps.push(currentStage);
          try {
            const condensedResult = await runRolePromptWithTrace(
              "analysis.synthesize",
              buildPaperCondensePrompt({
                outputLanguageLabel,
                normalizedPrompt,
                paperContext,
                chunkSummaries,
              }),
              contextRefs,
              true,
            );
            sourceBlock = buildCondensedPaperSourceBlock(paperContext, condensedResult.output);
            synthesisFallbackSourceBlock = buildFallbackPaperSourceBlock(sourceBlock);
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            await runtimeLogWrite("WARN", `analysis paper condense failed: ${reason}`).catch(() => undefined);
          }
        }
        snapshots = [
          {
            path: paperContext.sourcePath,
            kind: "paper",
            summary: `chunks=${paperContext.chunks.length}`,
            excerpt: sourceBlock.slice(0, 8000),
          },
        ];
        resolvedInputFiles = [task.sourcePath];
      } else {
        const promptRefs = resolvePromptInputFiles(normalizedPrompt, candidateFiles);
        const defaultInputFiles = csvCandidateFiles.length > 0 ? csvCandidateFiles : candidateFiles;
        const chosenFiles = promptRefs.resolved.length > 0 ? promptRefs.resolved : defaultInputFiles;
        if (promptRefs.unresolved.length > 0 && promptRefs.resolved.length === 0) {
          throw new Error(`${t("analysis.error.invalidInputRefs")}: ${promptRefs.unresolved.join(", ")}`);
        }
        if (chosenFiles.length === 0) {
          throw new Error(t("analysis.error.noInputFiles"));
        }
        resolvedInputFiles = chosenFiles;
        setStage(t("analysis.step.loadData"));
        steps.push(currentStage);
        snapshots = await loadDataSnapshots(projectId, chosenFiles);
        const snapshotSummary = summarizeSnapshotsForPrompt(snapshots);
        setStage(t("analysis.step.profileEachFile"));
        steps.push(currentStage);
        let pyodideProfileText = "{}";
        try {
          const pyodideProfile = await buildPyodideAnalysisProfile({
            snapshots,
            prompt: normalizedPrompt,
            outputLanguage: outputLanguageLabel,
          });
          pyodideProfileText = JSON.stringify(pyodideProfile, null, 2).slice(0, 12000);
          await runtimeLogWrite(
            "INFO",
            `analysis pyodide profile ready: source=${pyodideProfile.runtimeSource}, files=${pyodideProfile.fileCount}`
          ).catch(() => undefined);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          pyodideProfileText = JSON.stringify({
            runtimeSource: "unavailable",
            error: reason,
          });
          await runtimeLogWrite("WARN", `analysis pyodide profile failed: ${reason}`).catch(() => undefined);
        }
        sourceBlock = [
          snapshotSummary,
          "Structured profile (pyodide):",
          pyodideProfileText,
        ].join("\n\n");
      }
      if (selectedFile && editorContent.trim()) {
        sourceBlock = `${sourceBlock}\n\n---\n\nCurrent editor file (${selectedFile}):\n${editorContent.slice(0, 2200)}`;
      }
      setStage(t("analysis.step.agentSynthesis"));
      steps.push(currentStage);
      const runSynthesisPrompt = (promptText: string, bypassCache = false) =>
        runRolePromptWithTrace("analysis.synthesize", promptText, contextRefs, bypassCache);
      let finalResult;
      try {
        finalResult = await runSynthesisPrompt(
          buildAnalysisSynthesisPrompt(outputLanguageLabel, normalizedPrompt, sourceBlock),
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (!synthesisFallbackSourceBlock || !isRetryableAnalysisProviderError(reason)) {
          throw error;
        }
        finalResult = await runSynthesisPrompt(
          buildAnalysisSynthesisPrompt(outputLanguageLabel, normalizedPrompt, synthesisFallbackSourceBlock),
          true,
        );
      }
      let parsed = parsePayloadJson(finalResult.output);
      if (!hasStructuredAnalysisOutput(parsed)) {
        setStage(t("analysis.step.jsonRepair"));
        steps.push(currentStage);
        const repairResult = await runRolePromptWithTrace(
          "analysis.synthesize",
          buildAnalysisJsonRepairPrompt(outputLanguageLabel, finalResult.output),
          contextRefs,
          true,
        );
        parsed = parsePayloadJson(repairResult.output);
      }
      if (!hasStructuredAnalysisOutput(parsed)) {
        throw new Error("analysis.output.invalid_json");
      }
      const completed = buildCompletedAnalysisRun({
        task,
        parsed,
        snapshots,
        outputLanguage,
        resolvedInputFiles,
        eventRunIds: runIds,
        agentRunId: finalResult.runId,
        prompt: normalizedPrompt,
        steps,
        t,
      });
      const saved = await analysisSaveReport({
        projectId,
        runId: completed.runRecord.id,
        title: completed.runRecord.title,
        reportHtml: completed.reportHtml,
        assets: [{ fileName: "chart.svg", dataUrl: completed.chartDataUrl }],
      });
      const runRecord: AnalysisTaskRun = {
        ...completed.runRecord,
        reportRelativePath: saved.reportRelativePath,
        assetRelativePaths: saved.assetRelativePaths,
      };
      setActiveRunHtml(completed.reportHtml);
      updateTaskById(task.id, (item) => ({
        ...upsertRun(item, runRecord),
        lastError: null,
        draftPrompt: options?.savePrompt === false ? item.draftPrompt : "",
      }));
      setActiveTaskId(task.id);
      setToast({ type: "info", message: t("analysis.runDone") });
    } catch (error) {
      const rawMessage = String(error);
      if (rawMessage === "agent.run.cancelled" && suspended) {
        updateTaskById(task.id, (item) => ({
          ...item,
          lastError: null,
          updatedAt: nowIso(),
        }));
        return;
      }
      const reason = rawMessage === "agent.run.timeout.total"
        ? t("agent.run.timeout")
        : rawMessage === "agent.run.timeout.inactive"
          ? t("agent.run.timeout.inactive")
          : rawMessage;
      const message = `${t("analysis.error.failed")}: ${currentStage} · ${reason}`;
      updateTaskById(task.id, (item) => ({
        ...item,
        lastError: message,
        updatedAt: nowIso(),
      }));
      setToast({ type: "error", message });
      await runtimeLogWrite("ERROR", `analysis run failed: stage=${currentStage}; reason=${rawMessage}`).catch(() => undefined);
    } finally {
      runInFlightRef.current = false;
      setRunning(false);
      setLiveRunIds([]);
      setLiveStageLabel("");
    }
  }, [
    activeTaskId,
    candidateFiles,
    csvCandidateFiles,
    editorContent,
    ensureTasksReady,
    locale,
    projectId,
    selectedFile,
    setToast,
    t,
    updateTaskById,
  ]);
  const runAnalysis = useCallback(async () => runAnalysisForPrompt(prompt), [prompt, runAnalysisForPrompt]);
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














