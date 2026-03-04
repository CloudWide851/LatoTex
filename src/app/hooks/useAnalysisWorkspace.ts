import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  analysisExportArtifact,
  analysisSaveReport,
  runAgentStart,
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
import { createDefaultTask, loadAnalysisTaskState, saveAnalysisTaskState } from "./analysisTaskStore";
import type { AnalysisSourceType, AnalysisTask, AnalysisTaskRun } from "./analysisTypes";
import { newRunId, newTaskId, nowIso } from "./analysisTypes";
import {
  buildReportHtml,
  clampChart,
  deriveSections,
  extractEventCards,
  parsePayloadJson,
  summarizeSnapshotsForPrompt,
  toChartFromSnapshots,
  upsertRun,
  waitForRunOutput,
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
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<AnalysisTask[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const [selectedInputFiles, setSelectedInputFiles] = useState<string[]>([]);
  const [activeRunIds, setActiveRunIds] = useState<string[]>([]);
  const loadedRef = useRef(false);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  const timelineCards = useMemo(() => extractEventCards(events, activeRunIds), [events, activeRunIds]);

  useEffect(() => {
    if (!projectId) {
      setTasks([]);
      setActiveTaskId(null);
      setPrompt("");
      setSelectedInputFiles([]);
      loadedRef.current = false;
      return;
    }
    let cancelled = false;
    loadAnalysisTaskState(projectId, t("analysis.defaultTaskName"))
      .then((state) => {
        if (cancelled) {
          return;
        }
        setTasks(state.tasks);
        setActiveTaskId(state.activeTaskId);
        if (candidateFiles.length > 0) {
          setSelectedInputFiles(csvCandidateFiles.length > 0 ? csvCandidateFiles : candidateFiles);
        }
        loadedRef.current = true;
      })
      .catch((error) => {
        if (!cancelled) {
          setToast({ type: "error", message: String(error) });
          const fallback = createDefaultTask(t("analysis.defaultTaskName"));
          setTasks([fallback]);
          setActiveTaskId(fallback.id);
          loadedRef.current = true;
        }
      });
    return () => {
      cancelled = true;
    };
  }, [candidateFiles, csvCandidateFiles, projectId, setToast, t]);

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

  const setActiveRunForTask = useCallback((taskId: string, runId: string) => {
    setTasks((prev) => prev.map((item) => (item.id === taskId ? { ...item, activeRunId: runId, updatedAt: nowIso() } : item)));
  }, []);

  const createTask = useCallback((sourceType: AnalysisSourceType = "data", sourcePath?: string, name?: string) => {
    const createdAt = nowIso();
    const task: AnalysisTask = {
      id: newTaskId("analysis"),
      name: (name?.trim() || t("analysis.defaultTaskName")).slice(0, 64),
      sourceType,
      sourcePath,
      runs: [],
      createdAt,
      updatedAt: createdAt,
    };
    setTasks((prev) => [task, ...prev]);
    setActiveTaskId(task.id);
    return task;
  }, [t]);

  const renameTask = useCallback((taskId: string, name: string) => {
    const normalized = name.trim();
    if (!normalized) {
      return;
    }
    setTasks((prev) => prev.map((item) => (item.id === taskId ? { ...item, name: normalized.slice(0, 64), updatedAt: nowIso() } : item)));
  }, []);

  const deleteTask = useCallback((taskId: string) => {
    setTasks((prev) => {
      const next = prev.filter((item) => item.id !== taskId);
      if (next.length === 0) {
        const fallback = createDefaultTask(t("analysis.defaultTaskName"));
        setActiveTaskId(fallback.id);
        return [fallback];
      }
      if (activeTaskId === taskId) {
        setActiveTaskId(next[0].id);
      }
      return next;
    });
  }, [activeTaskId, t]);

  const toggleInputFile = useCallback((path: string) => {
    setSelectedInputFiles((prev) => (prev.includes(path) ? prev.filter((item) => item !== path) : [...prev, path]));
  }, []);

  const selectAllInputs = useCallback(() => {
    setSelectedInputFiles(candidateFiles);
  }, [candidateFiles]);

  const invertInputs = useCallback(() => {
    setSelectedInputFiles((prev) => candidateFiles.filter((item) => !prev.includes(item)));
  }, [candidateFiles]);

  const runRolePrompt = useCallback(async (role: string, promptText: string, contextRefs: string[]) => {
    if (!projectId) {
      throw new Error("project missing");
    }
    const accepted = await runAgentStart({
      projectId,
      role,
      prompt: promptText,
      contextRefs,
      bypassCache: true,
    });
    setActiveRunIds((prev) => [...prev, accepted.runId]);
    return {
      runId: accepted.runId,
      output: await waitForRunOutput(accepted.runId),
    };
  }, [projectId]);

  const runAnalysisForPrompt = useCallback(async (inputPrompt: string, forcedTaskId?: string) => {
    const normalizedPrompt = inputPrompt.trim();
    if (!projectId) {
      setAnalysisError(t("analysis.error.noProject"));
      return;
    }
    const targetTaskId = forcedTaskId ?? activeTaskId;
    const task = tasks.find((item) => item.id === targetTaskId) ?? null;
    if (!task) {
      setAnalysisError(t("analysis.error.noTask"));
      return;
    }
    if (!normalizedPrompt) {
      setAnalysisError(t("analysis.error.emptyPrompt"));
      return;
    }
    setAnalysisError(null);
    setRunning(true);
    setActiveRunIds([]);

    try {
      const outputLanguage = resolveAnalysisLanguage(normalizedPrompt, locale);
      const outputLanguageLabel = languageLabel(outputLanguage);
      const contextRefs: string[] = [];
      if (selectedFile) {
        contextRefs.push(`file:${selectedFile}`);
      }

      let snapshots: AnalysisSourceSnapshot[] = [];
      let sourceBlock = "";
      const steps: string[] = [];
      if (task.sourceType === "paper" && task.sourcePath) {
        steps.push(t("analysis.step.paperExtract"));
        const paperContext = await buildPaperAnalysisContext(projectId, task.sourcePath);
        const chunkSummaries: string[] = [];
        for (const chunk of paperContext.chunks) {
          const chunkPrompt = [
            `Summarize the following paper segment in ${outputLanguageLabel}.`,
            "Return concise markdown bullet points of methods, findings, and limitations.",
            `Chunk pages: ${chunk.pageStart}-${chunk.pageEnd}`,
            chunk.text,
          ].join("\n\n");
          const chunkResult = await runRolePrompt("explore", chunkPrompt, contextRefs);
          chunkSummaries.push(`[Chunk ${chunk.chunkIndex + 1} | pages ${chunk.pageStart}-${chunk.pageEnd}]\n${chunkResult.output}`);
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
      } else {
        const defaultInputFiles = csvCandidateFiles.length > 0 ? csvCandidateFiles : candidateFiles;
        const chosenFiles = selectedInputFiles.length > 0 ? selectedInputFiles : defaultInputFiles;
        if (chosenFiles.length === 0) {
          throw new Error(t("analysis.error.noInputFiles"));
        }
        steps.push(t("analysis.step.loadData"));
        snapshots = await loadDataSnapshots(projectId, chosenFiles);
        const snapshotSummary = summarizeSnapshotsForPrompt(snapshots);

        steps.push(t("analysis.step.profileEachFile"));
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
            const profileResult = await runRolePrompt("explore", profilePrompt, contextRefs);
            perFileProfiles.push(`[${snapshot.path}]\n${profileResult.output}`);
          } catch {
            perFileProfiles.push(`[${snapshot.path}]\nprofile_failed`);
          }
        }

        steps.push(t("analysis.step.crossFile"));
        const crossFilePrompt = [
          `Output language must be ${outputLanguageLabel}.`,
          "You are performing cross-file analysis.",
          "Find relationships, inconsistencies, and linked hypotheses across files.",
          `Total selected files: ${chosenFiles.length}.`,
          "Per-file profiles:",
          perFileProfiles.join("\n\n"),
        ].join("\n\n");
        const crossFileResult = await runRolePrompt("explore", crossFilePrompt, contextRefs);

        steps.push(t("analysis.step.deepDive"));
        const deepDivePrompt = [
          `Output language must be ${outputLanguageLabel}.`,
          "Deep dive into the most important findings and likely root causes.",
          "Return compact markdown with: key finding, evidence, confidence, and verification plan.",
          "User request:",
          normalizedPrompt,
          "Cross-file synthesis:",
          crossFileResult.output,
        ].join("\n\n");
        const deepDiveResult = await runRolePrompt("explore", deepDivePrompt, contextRefs);

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

      steps.push(t("analysis.step.agentSynthesis"));
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
      const finalResult = await runRolePrompt("task", agentPrompt, contextRefs);
      const parsed = parsePayloadJson(finalResult.output);

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
        inputFiles: task.sourceType === "paper"
          ? [task.sourcePath ?? ""]
          : (selectedInputFiles.length > 0
            ? selectedInputFiles
            : (csvCandidateFiles.length > 0 ? csvCandidateFiles : candidateFiles)),
        outputLanguage,
        agentRunId: finalResult.runId,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };

      setTasks((prev) =>
        prev.map((item) => {
          if (item.id !== task.id) {
            return item;
          }
          return upsertRun(item, runRecord);
        }),
      );
      setActiveTaskId(task.id);
      setPrompt("");
      setToast({ type: "info", message: t("analysis.runDone") });
    } catch (error) {
      const message = `${t("analysis.error.failed")}: ${String(error)}`;
      setAnalysisError(message);
      setToast({ type: "error", message });
      await runtimeLogWrite("ERROR", `analysis run failed: ${String(error)}`).catch(() => undefined);
    } finally {
      setRunning(false);
    }
  }, [
    activeTaskId,
    candidateFiles,
    csvCandidateFiles,
    editorContent,
    locale,
    projectId,
    runRolePrompt,
    selectedFile,
    selectedInputFiles,
    setToast,
    t,
    tasks,
  ]);

  const runAnalysis = useCallback(async () => {
    await runAnalysisForPrompt(prompt);
  }, [prompt, runAnalysisForPrompt]);

  const runAnalysisWithPrompt = useCallback(async (inputPrompt: string) => {
    setPrompt(inputPrompt);
    await runAnalysisForPrompt(inputPrompt);
  }, [runAnalysisForPrompt]);

  const runPaperAnalysisFromLibrary = useCallback(async (sourcePath: string) => {
    const task = createTask("paper", sourcePath, `${t("analysis.paperTaskName")}: ${sourcePath.split("/").pop() || sourcePath}`);
    const promptText = t("analysis.paperDefaultPrompt");
    setPrompt(promptText);
    await runAnalysisForPrompt(promptText, task.id);
  }, [createTask, runAnalysisForPrompt, t]);

  const exportArtifact = useCallback(async (relativePath: string) => {
    if (!projectId) {
      return;
    }
    try {
      await analysisExportArtifact(projectId, relativePath);
    } catch (error) {
      setToast({ type: "error", message: String(error) });
    }
  }, [projectId, setToast]);

  const revealArtifact = useCallback(async (relativePath: string) => {
    if (!projectId) {
      return;
    }
    try {
      await workspaceRevealInSystem(projectId, relativePath);
    } catch (error) {
      setToast({ type: "error", message: String(error) });
    }
  }, [projectId, setToast]);

  return {
    prompt,
    setPrompt,
    running,
    canRun,
    analysisError,
    tasks,
    activeTaskId,
    activeTask,
    activeRun,
    timelineCards,
    filePickerOpen,
    setFilePickerOpen,
    candidateFiles,
    selectedInputFiles,
    setSelectedInputFiles,
    toggleInputFile,
    selectAllInputs,
    invertInputs,
    setActiveTaskId,
    setActiveRunForTask,
    createTask,
    renameTask,
    deleteTask,
    runAnalysis,
    runAnalysisWithPrompt,
    runPaperAnalysisFromLibrary,
    exportArtifact,
    revealArtifact,
  };
}
