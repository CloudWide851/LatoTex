import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  analysisExportArtifact,
  analysisSaveReport,
  readFile,
  runtimeLogWrite,
  workspaceRevealInSystem,
} from "../../shared/api/desktop";
import type { SwarmEvent } from "../../shared/types/app";
import {
  buildPaperAnalysisContext,
  listCandidateDataFiles,
  loadDataSnapshots,
  type AnalysisSourceSnapshot,
} from "./analysisDataSources";
import { languageLabel, resolveAnalysisLanguage } from "./analysisLanguage";
import { resolvePromptInputFiles } from "./analysisPromptRefs";
import { loadAnalysisTaskState, saveAnalysisTaskState } from "./analysisTaskStore";
import { createAnalysisTask, deleteTaskFromList, renameTaskList, updateTaskListById } from "./analysisTaskActions";
import { ensureAnalysisTasksLoaded, runRolePromptWithAgent } from "./analysisRunHelpers";
import type { AnalysisSourceType, AnalysisTask, AnalysisTaskRun } from "./analysisTypes";
import { newRunId, nowIso } from "./analysisTypes";
import {
  buildReportHtml,
  clampChart,
  deriveSections,
  extractEventCards,
  parsePayloadJson,
  summarizeSnapshotsForPrompt,
  toChartFromSnapshots,
  upsertRun,
} from "./analysisWorkspaceHelpers";

type TranslationFn = (key: any) => string;
export function useAnalysisWorkspace(params: {
  projectId: string | null;
  selectedFile: string | null;
  editorContent: string;
  fileList: string[];
  locale: "zh-CN" | "en-US";
  events: SwarmEvent[];
  t: TranslationFn;
  setToast: (value: { type: "info" | "error"; message: string } | null) => void;
}) {
  const { projectId, selectedFile, editorContent, fileList, locale, events, setToast, t } = params;
  const [running, setRunning] = useState(false);
  const [tasks, setTasks] = useState<AnalysisTask[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeRunHtml, setActiveRunHtml] = useState("");
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

  const canRun = useMemo(() => Boolean(projectId && activeTask && prompt.trim()), [activeTask, projectId, prompt]);

  const updateTaskById = useCallback((taskId: string, updater: (task: AnalysisTask) => AnalysisTask) => {
    setTasks((prev) => updateTaskListById(prev, taskId, updater));
  }, []);

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
    if (options?.savePrompt !== false) {
      updateTaskById(task.id, (item) => ({
        ...item,
        draftPrompt: normalizedPrompt,
        lastError: null,
        updatedAt: nowIso(),
      }));
    } else {
      updateTaskById(task.id, (item) => ({
        ...item,
        lastError: null,
        updatedAt: nowIso(),
      }));
    }
    setRunning(true);
    let currentStage = t("analysis.step.agentSynthesis");

    try {
      const setStage = (label: string) => {
        currentStage = label;
      };
      const runIds: string[] = [];
      const runRolePromptWithTrace = async (
        role: string,
        promptText: string,
        contextRefs: string[],
        bypassCache = false,
      ) => {
        const result = await runRolePromptWithAgent({
          projectId,
          role,
          promptText,
          contextRefs,
          bypassCache,
        });
        runIds.push(result.runId);
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
      let resolvedInputFiles: string[] = [];
      const steps: string[] = [];
      if (task.sourceType === "paper" && task.sourcePath) {
        setStage(t("analysis.step.paperExtract"));
        steps.push(currentStage);
        const paperContext = await buildPaperAnalysisContext(projectId, task.sourcePath);
        const chunkSummaries: string[] = [];
        let chunkFailures = 0;
        for (const chunk of paperContext.chunks) {
          const chunkPrompt = [
            `Summarize the following paper segment in ${outputLanguageLabel}.`,
            "Return concise markdown bullet points of methods, findings, and limitations.",
            `Chunk pages: ${chunk.pageStart}-${chunk.pageEnd}`,
            chunk.text,
          ].join("\n\n");
          try {
            const chunkResult = await runRolePromptWithTrace("explore", chunkPrompt, contextRefs);
            chunkSummaries.push(`[Chunk ${chunk.chunkIndex + 1} | pages ${chunk.pageStart}-${chunk.pageEnd}]\n${chunkResult.output}`);
          } catch (error) {
            chunkFailures += 1;
            await runtimeLogWrite(
              "WARN",
              `analysis paper chunk failed: path=${task.sourcePath}, chunk=${chunk.chunkIndex + 1}, reason=${String(error)}`,
            ).catch(() => undefined);
          }
        }
        if (paperContext.chunks.length > 0 && chunkSummaries.length === 0) {
          throw new Error(`analysis.paper.chunk_failed_all(${chunkFailures})`);
        }
        sourceBlock = [
          `Paper source: ${paperContext.sourcePath}`,
          `Title: ${paperContext.title}`,
          "Metadata:",
          paperContext.metadataBlock,
          "Chunk summaries:",
          chunkSummaries.join("\n\n"),
        ].join("\n\n");
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
        const perFileProfiles: string[] = [];
        const profileTargets = snapshots.slice(0, Math.min(12, snapshots.length));
        for (const snapshot of profileTargets) {
          const profilePrompt = [
            `Output language must be ${outputLanguageLabel}.`,
            "Profile this file and return compact markdown with fields:",
            "overview, data quality, anomalies, and actionable next checks.",
            `File: ${snapshot.path}`,
            `Summary: ${snapshot.summary}`,
            "Excerpt:",
            snapshot.excerpt.slice(0, 2400),
          ].join("\n\n");
          try {
            const profileResult = await runRolePromptWithTrace("explore", profilePrompt, contextRefs);
            perFileProfiles.push(`[${snapshot.path}]\n${profileResult.output}`);
          } catch {
            perFileProfiles.push(`[${snapshot.path}]\nprofile_failed`);
          }
        }

        setStage(t("analysis.step.crossFile"));
        steps.push(currentStage);
        const crossFilePrompt = [
          `Output language must be ${outputLanguageLabel}.`,
          "You are performing cross-file analysis.",
          "Find relationships, inconsistencies, and linked hypotheses across files.",
          `Total selected files: ${chosenFiles.length}.`,
          "Per-file profiles:",
          perFileProfiles.join("\n\n"),
        ].join("\n\n");
        const crossFileResult = await runRolePromptWithTrace("explore", crossFilePrompt, contextRefs);

        setStage(t("analysis.step.deepDive"));
        steps.push(currentStage);
        const deepDivePrompt = [
          `Output language must be ${outputLanguageLabel}.`,
          "Deep dive into the most important findings and likely root causes.",
          "Return compact markdown with: key finding, evidence, confidence, and verification plan.",
          "User request:",
          normalizedPrompt,
          "Cross-file synthesis:",
          crossFileResult.output,
        ].join("\n\n");
        const deepDiveResult = await runRolePromptWithTrace("explore", deepDivePrompt, contextRefs);

        sourceBlock = [
          snapshotSummary,
          "Per-file profile summary:",
          perFileProfiles.join("\n\n"),
          "Cross-file synthesis:",
          crossFileResult.output,
          "Deep-dive findings:",
          deepDiveResult.output,
        ].join("\n\n");
      }

      if (selectedFile && editorContent.trim()) {
        sourceBlock = `${sourceBlock}\n\n---\n\nCurrent editor file (${selectedFile}):\n${editorContent.slice(0, 2200)}`;
      }

      setStage(t("analysis.step.agentSynthesis"));
      steps.push(currentStage);
      const agentPrompt = [
        `You are a senior data analyst. Output language must be ${outputLanguageLabel}.`,
        "Return strict JSON only with keys:",
        "title (string), summary (string), steps (string[]), insights (string[]), sections ({title,content}[]), chart ({label,value}[])",
        "The report must be complete, practical, and visually-oriented.",
        "If user asks another language explicitly, honor user request.",
        "User request:",
        normalizedPrompt,
        "\nSource material:",
        sourceBlock,
      ].join("\n\n");
      const finalResult = await runRolePromptWithTrace("task", agentPrompt, contextRefs);
      const hasStructuredOutput = (parsed: Record<string, unknown>) => Boolean(
        (typeof parsed.title === "string" && parsed.title.trim().length > 0)
        || (typeof parsed.summary === "string" && parsed.summary.trim().length > 0)
        || (Array.isArray(parsed.sections) && parsed.sections.length > 0)
        || (Array.isArray(parsed.insights) && parsed.insights.length > 0),
      );
      let parsed = parsePayloadJson(finalResult.output);
      if (!hasStructuredOutput(parsed as unknown as Record<string, unknown>)) {
        setStage(t("analysis.step.jsonRepair"));
        steps.push(currentStage);
        const repairPrompt = [
          `Output language must be ${outputLanguageLabel}.`,
          "You are a strict JSON formatter.",
          "Transform the source text into a strict JSON object only (no markdown code block).",
          "Allowed keys only:",
          "title (string), summary (string), steps (string[]), insights (string[]), sections ({title,content}[]), chart ({label,value}[])",
          "If unknown, use empty strings/arrays. Do not omit keys.",
          "Source output to normalize:",
          finalResult.output.slice(0, 14_000),
        ].join("\n\n");
        const repairResult = await runRolePromptWithTrace("task", repairPrompt, contextRefs, true);
        parsed = parsePayloadJson(repairResult.output);
      }
      if (!hasStructuredOutput(parsed as unknown as Record<string, unknown>)) {
        throw new Error("analysis.output.invalid_json");
      }

      const chartSource = clampChart(
        Array.isArray(parsed.chart)
          ? parsed.chart
              .map((item) => ({ label: String(item.label ?? ""), value: Number(item.value ?? Number.NaN) }))
              .filter((item) => item.label && Number.isFinite(item.value))
          : [],
      );
      const fallbackChart = toChartFromSnapshots(snapshots);
      const chart = chartSource.length > 0 ? chartSource : fallbackChart;
      const labels = chart.map((item) => item.label);
      const values = chart.map((item) => item.value);

      const mergedSteps = Array.from(
        new Set([
          ...steps,
          ...(Array.isArray(parsed.steps) ? parsed.steps.map((item) => String(item)) : []),
        ]),
      ).slice(0, 20);
      const insights = (Array.isArray(parsed.insights) ? parsed.insights.map((item) => String(item)) : [])
        .filter((item) => item.trim())
        .slice(0, 24);
      const sections = deriveSections(parsed);
      const runRecordId = newRunId("analysis-run");

      const resultTitle = (parsed.title?.trim() || `${task.name} - ${t("analysis.defaultTitle")}`).slice(0, 120);
      const resultSummary = parsed.summary?.trim() || t("analysis.defaultSummary");
      const report = buildReportHtml({
        language: outputLanguage,
        title: resultTitle,
        summary: resultSummary,
        steps: mergedSteps.length > 0 ? mergedSteps : [t("analysis.defaultStep")],
        insights: insights.length > 0 ? insights : [t("analysis.defaultInsight")],
        sections,
        labels,
        values,
      });

      const saved = await analysisSaveReport({
        projectId,
        runId: runRecordId,
        title: resultTitle,
        reportHtml: report.html,
        assets: [{ fileName: "chart.svg", dataUrl: report.chartDataUrl }],
      });

      const runRecord: AnalysisTaskRun = {
        id: runRecordId,
        prompt: normalizedPrompt,
        title: resultTitle,
        summary: resultSummary,
        reportHtml: report.html,
        reportRelativePath: saved.reportRelativePath,
        assetRelativePaths: saved.assetRelativePaths,
        labels,
        values,
        insights,
        steps: mergedSteps,
        sourceType: task.sourceType,
        sourcePath: task.sourcePath,
        inputFiles: resolvedInputFiles,
        outputLanguage,
        agentRunId: finalResult.runId,
        eventRunIds: Array.from(new Set(runIds)),
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };

      updateTaskById(task.id, (item) => ({
        ...upsertRun(item, runRecord),
        lastError: null,
        draftPrompt: options?.savePrompt === false ? item.draftPrompt : "",
      }));
      setActiveTaskId(task.id);
      setToast({ type: "info", message: t("analysis.runDone") });
    } catch (error) {
      const rawMessage = String(error);
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
    }
  }, [
    activeTaskId,
    candidateFiles,
    csvCandidateFiles,
    editorContent,
    ensureTasksReady,
    locale,
    projectId,
    runRolePromptWithAgent,
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
    await ensureTasksReady();
    if (runInFlightRef.current) {
      setToast({ type: "info", message: t("analysis.running") });
      return;
    }
    const normalizedPath = sourcePath.replace(/\\/g, "/");
    const existingTask = tasksRef.current.find((item) => item.sourceType === "paper" && (item.sourcePath ?? "").replace(/\\/g, "/") === normalizedPath);
    const task = existingTask ?? createTask("paper", normalizedPath, `${t("analysis.paperTaskName")}: ${normalizedPath.split("/").pop() || normalizedPath}`);
    setActiveTaskId(task.id);
    updateTaskById(task.id, (item) => ({
      ...item,
      draftPrompt: "",
      lastError: null,
      updatedAt: nowIso(),
    }));
    const promptText = t("analysis.paperDefaultPrompt");
    await runAnalysisForPrompt(promptText, {
      forcedTaskId: task.id,
      taskSnapshot: task,
      savePrompt: false,
    });
  }, [createTask, ensureTasksReady, runAnalysisForPrompt, setToast, t, updateTaskById]);

  const exportArtifact = useCallback(async (relativePath: string) => {
    if (!projectId) return;
    try {
      await analysisExportArtifact(projectId, relativePath);
    } catch (error) {
      setToast({ type: "error", message: String(error) });
    }
  }, [projectId, setToast]);

  const revealArtifact = useCallback(async (relativePath: string) => {
    if (!projectId) return;
    try {
      await workspaceRevealInSystem(projectId, relativePath);
    } catch (error) {
      setToast({ type: "error", message: String(error) });
    }
  }, [projectId, setToast]);

  return { prompt, setPrompt, running, canRun, analysisError, tasks, activeTaskId, activeTask, activeRun, activeRunHtml, timelineCards, candidateFiles, setActiveTaskId, setActiveRunForTask, createTask, renameTask, deleteTask, runAnalysis, runAnalysisWithPrompt, runPaperAnalysisFromLibrary, exportArtifact, revealArtifact };
}
