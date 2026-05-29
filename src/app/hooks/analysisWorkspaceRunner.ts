import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { Locale } from "../../i18n";
import type { AgentTeamMode } from "../../shared/types/app";
import { analysisEnvPrepare, analysisRunPython, analysisSaveReport } from "../../shared/api/analysis";
import { runtimeLogWrite } from "../../shared/api/runtime";
import {
  buildPaperAnalysisContext,
  loadDataSnapshots,
  type AnalysisSourceSnapshot,
} from "./analysisDataSources";
import { languageLabel, resolveAnalysisLanguage } from "./analysisLanguage";
import { resolvePromptInputFiles } from "./analysisPromptRefs";
import { ensureAnalysisTasksLoaded, isRetryableAnalysisProviderError, runRolePromptWithAgent } from "./analysisRunHelpers";
import type { AnalysisTask, AnalysisTaskRun } from "./analysisTypes";
import { nowIso } from "./analysisTypes";
import {
  buildAnalysisPromptSignature,
  buildPaperChunkSummariesCacheKey,
  buildPaperCondensedSourceCacheKey,
  buildPaperContextSignature,
  buildPythonProfileCacheKey,
  buildSnapshotSignature,
  readCachedAnalysisStageValue,
  trimCachedPythonProfile,
  type AnalysisCachedChunkSummaries,
  type AnalysisStageCacheStore,
} from "./analysisStageCache";
import {
  parsePayloadJson,
  summarizeSnapshotsForPrompt,
  upsertRun,
} from "./analysisWorkspaceHelpers";
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
  buildPendingAnalysisRun,
  hasStructuredAnalysisOutput,
} from "./analysisWorkspaceRunResult";

type ToastSetter = (value: { type: "info" | "error"; message: string }) => void;
type TranslationFn = (key: any) => string;

export type RunAnalysisWorkspacePromptOptions = {
  forcedTaskId?: string;
  taskSnapshot?: AnalysisTask;
  savePrompt?: boolean;
  teamMode?: AgentTeamMode;
};

export type RunAnalysisWorkspacePromptParams = {
  inputPrompt: string;
  options?: RunAnalysisWorkspacePromptOptions;
  suspended: boolean;
  projectId: string | null;
  activeTaskId: string | null;
  selectedFile: string | null;
  editorContent: string;
  candidateFiles: string[];
  csvCandidateFiles: string[];
  locale: Locale;
  analysisModelOverride: string | null | undefined;
  liveOutput: string;
  runGeneration?: number;
  isRunGenerationCurrent?: (generation: number) => boolean;
  tasksRef: MutableRefObject<AnalysisTask[]>;
  loadedRef: MutableRefObject<boolean>;
  runInFlightRef: MutableRefObject<boolean>;
  liveTaskIdRef: MutableRefObject<string | null>;
  liveTaskRunIdRef: MutableRefObject<string | null>;
  ensureStageCache: () => Promise<AnalysisStageCacheStore>;
  persistStageCacheEntry: (key: string, value: unknown) => Promise<void>;
  updateTaskById: (taskId: string, updater: (task: AnalysisTask) => AnalysisTask) => void;
  setActiveTaskId: Dispatch<SetStateAction<string | null>>;
  setActiveRunHtml: Dispatch<SetStateAction<string>>;
  setLiveRunIds: Dispatch<SetStateAction<string[]>>;
  setLiveStageLabel: Dispatch<SetStateAction<string>>;
  setRunning: Dispatch<SetStateAction<boolean>>;
  setToast: ToastSetter;
  t: TranslationFn;
};

export async function runAnalysisWorkspacePrompt(params: RunAnalysisWorkspacePromptParams) {
  const {
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
  } = params;
  const ensureTasksReady = async () => ensureAnalysisTasksLoaded(loadedRef);
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
    setActiveRunHtml("");
    setLiveRunIds([]);
    setLiveStageLabel("");
    let currentStage = t("analysis.step.agentSynthesis");
    let pendingRunFallback: AnalysisTaskRun | null = null;
    let pendingRunId = "";
    try {
      const setStage = (label: string) => {
        currentStage = label;
        setLiveStageLabel(label);
      };
      const runIds: string[] = [];
      const stageCache = await ensureStageCache();
      const outputLanguage = resolveAnalysisLanguage(normalizedPrompt, locale);
      const outputLanguageLabel = languageLabel(outputLanguage);
      const nextPendingRun = buildPendingAnalysisRun({
        task,
        prompt: normalizedPrompt,
        outputLanguage,
        t,
      });
      pendingRunFallback = nextPendingRun;
      pendingRunId = nextPendingRun.id;
      liveTaskIdRef.current = task.id;
      liveTaskRunIdRef.current = pendingRunId;
      updateTaskById(task.id, (item) => ({
        ...upsertRun(item, nextPendingRun),
        lastError: null,
      }));
      setActiveTaskId(task.id);
      const appendAcceptedRun = (acceptedRunId: string) => {
        runIds.push(acceptedRunId);
        setLiveRunIds((prev) => (prev.includes(acceptedRunId) ? prev : [...prev, acceptedRunId]));
        updateTaskById(task.id, (item) => {
          const existing = item.runs.find((candidate) => candidate.id === pendingRunId);
          if (!existing) {
            return item;
          }
          const nextEventRunIds = Array.from(new Set([...(existing.eventRunIds ?? []), acceptedRunId]));
          if (nextEventRunIds.length === (existing.eventRunIds ?? []).length) {
            return item;
          }
          return upsertRun(item, {
            ...existing,
            eventRunIds: nextEventRunIds,
            updatedAt: nowIso(),
          });
        });
      };
      const runRolePromptWithTrace = async (
        workflowId: string,
        promptText: string,
        contextRefs: string[],
        bypassCache = false,
      ) => runRolePromptWithAgent({
        projectId,
        workflowId,
        promptText,
        contextRefs,
        modelOverride: analysisModelOverride ?? undefined,
        bypassCache,
        teamMode: options?.teamMode ?? "auto",
        onAcceptedRunId: appendAcceptedRun,
      });
      const promptSignature = buildAnalysisPromptSignature(normalizedPrompt, outputLanguageLabel);
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
        const paperContextSignature = buildPaperContextSignature(paperContext);
        const chunkCacheKey = buildPaperChunkSummariesCacheKey(
          task.sourcePath,
          outputLanguageLabel,
          paperContextSignature,
        );
        const cachedChunks = readCachedAnalysisStageValue<AnalysisCachedChunkSummaries>(stageCache, chunkCacheKey);
        const { chunkSummaries, chunkFailures } = cachedChunks ?? await summarizePaperChunks({
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
        if (cachedChunks) {
          await runtimeLogWrite(
            "INFO",
            `analysis cache hit: paper chunk summaries, path=${task.sourcePath}`,
          ).catch(() => undefined);
        } else {
          await persistStageCacheEntry(chunkCacheKey, { chunkSummaries, chunkFailures });
          await runtimeLogWrite(
            "INFO",
            `analysis cache store: paper chunk summaries, path=${task.sourcePath}`,
          ).catch(() => undefined);
        }
        if (paperContext.chunks.length > 0 && chunkSummaries.length === 0) {
          throw new Error(`analysis.paper.chunk_failed_all(${chunkFailures})`);
        }
        const rawPaperSourceBlock = buildPaperSourceBlock(paperContext, chunkSummaries);
        sourceBlock = rawPaperSourceBlock;
        synthesisFallbackSourceBlock = buildFallbackPaperSourceBlock(rawPaperSourceBlock);
        if (shouldCondensePaperSource(rawPaperSourceBlock, paperContext.chunks.length)) {
          setStage(t("analysis.step.crossFile"));
          steps.push(currentStage);
          const condenseCacheKey = buildPaperCondensedSourceCacheKey(
            task.sourcePath,
            outputLanguageLabel,
            paperContextSignature,
            promptSignature,
          );
          const cachedCondensedSource = readCachedAnalysisStageValue<string>(stageCache, condenseCacheKey);
          if (cachedCondensedSource) {
            sourceBlock = cachedCondensedSource;
            synthesisFallbackSourceBlock = buildFallbackPaperSourceBlock(sourceBlock);
            await runtimeLogWrite(
              "INFO",
              `analysis cache hit: paper condensed source, path=${task.sourcePath}`,
            ).catch(() => undefined);
          } else {
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
              await persistStageCacheEntry(condenseCacheKey, sourceBlock);
            } catch (error) {
              const reason = error instanceof Error ? error.message : String(error);
              await runtimeLogWrite("WARN", `analysis paper condense failed: ${reason}`).catch(() => undefined);
            }
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
        let pythonProfileText = "{}";
        const snapshotSignature = buildSnapshotSignature(snapshots);
        const pythonProfileCacheKey = buildPythonProfileCacheKey(
          outputLanguageLabel,
          promptSignature,
          snapshotSignature,
        );
        const cachedPythonProfile = readCachedAnalysisStageValue<ReturnType<typeof trimCachedPythonProfile>>(
          stageCache,
          pythonProfileCacheKey,
        );
        try {
          let pythonProfile: ReturnType<typeof trimCachedPythonProfile>;
          if (cachedPythonProfile) {
            pythonProfile = cachedPythonProfile;
            await runtimeLogWrite(
              "INFO",
              `analysis cache hit: python profile, files=${snapshots.length}`,
            ).catch(() => undefined);
          } else {
            const envStatus = await analysisEnvPrepare(projectId);
            pythonProfile = trimCachedPythonProfile(await analysisRunPython({
              projectId,
              taskId: task.id,
              prompt: normalizedPrompt,
              outputLanguage: outputLanguageLabel,
              snapshots,
            }));
            await runtimeLogWrite(
              "INFO",
              `analysis python profile ready: source=${pythonProfile.runtimeSource}, files=${snapshots.length}, python=${envStatus.pythonPath ?? "-"}`,
            ).catch(() => undefined);
            await persistStageCacheEntry(pythonProfileCacheKey, pythonProfile);
          }
          pythonProfileText = JSON.stringify(pythonProfile.profileJson, null, 2).slice(0, 12000);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          pythonProfileText = JSON.stringify({
            runtimeSource: "uv",
            status: "unavailable",
            error: reason,
          });
          await runtimeLogWrite("WARN", `analysis python profile failed: ${reason}`).catch(() => undefined);
        }
        sourceBlock = [
          snapshotSummary,
          "Structured profile (python/uv):",
          pythonProfileText,
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
        runId: pendingRunId,
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
        ...upsertRun(item, {
          ...runRecord,
          eventRunIds: Array.from(new Set([
            ...(item.runs.find((candidate) => candidate.id === pendingRunId)?.eventRunIds ?? []),
            ...(runRecord.eventRunIds ?? []),
          ])),
        }),
        lastError: null,
        draftPrompt: options?.savePrompt === false ? item.draftPrompt : "",
      }));
      setActiveTaskId(task.id);
      setToast({ type: "info", message: t("analysis.runDone") });
    } catch (error) {
      const rawMessage = String(error);
      if (rawMessage === "agent.run.cancelled" && suspended) {
        updateTaskById(task.id, (item) => ({
          ...(() => {
            const fallbackRun = item.runs.find((candidate) => candidate.id === pendingRunId) ?? pendingRunFallback;
            if (!fallbackRun) {
              return item;
            }
            return upsertRun(item, {
              ...fallbackRun,
              status: "cancelled",
              draftOutputText: liveOutput || item.runs.find((candidate) => candidate.id === pendingRunId)?.draftOutputText || "",
              liveStageLabel: currentStage,
              failureMessage: undefined,
              updatedAt: nowIso(),
            });
          })(),
          lastError: null,
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
        ...(() => {
          const fallbackRun = item.runs.find((candidate) => candidate.id === pendingRunId) ?? pendingRunFallback;
          if (!fallbackRun) {
            return item;
          }
          return upsertRun(item, {
            ...fallbackRun,
            status: "failed",
            draftOutputText: liveOutput || item.runs.find((candidate) => candidate.id === pendingRunId)?.draftOutputText || "",
            liveStageLabel: currentStage,
            failureMessage: message,
            updatedAt: nowIso(),
          });
        })(),
        lastError: message,
      }));
      setActiveRunHtml("");
      setToast({ type: "error", message });
      await runtimeLogWrite("ERROR", `analysis run failed: stage=${currentStage}; reason=${rawMessage}`).catch(() => undefined);
    } finally {
      runInFlightRef.current = false;
      setRunning(false);
      setLiveRunIds([]);
      setLiveStageLabel("");
      liveTaskIdRef.current = null;
      liveTaskRunIdRef.current = null;
    }
}

