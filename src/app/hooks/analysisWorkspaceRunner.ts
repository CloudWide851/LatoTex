import type {
  AcademicEvidence, AcademicProviderHealth, AnalysisResearchStage, ReferenceCheckResponse,
} from "../../shared/types/app";
import { runtimeLogWrite } from "../../shared/api/runtime";
import { buildPaperAnalysisContext, type AnalysisSourceSnapshot } from "./analysisDataSources";
import { languageLabel, resolveAnalysisLanguage } from "./analysisLanguage";
import { ensureAnalysisTasksLoaded, isRetryableAnalysisProviderError, runRolePromptWithAgent } from "./analysisRunHelpers";
import type { AnalysisTaskRun } from "./analysisTypes";
import { nowIso } from "./analysisTypes";
import {
  buildAnalysisPromptSignature,
  buildPaperChunkSummariesCacheKey,
  buildPaperCondensedSourceCacheKey,
  buildPaperContextSignature,
  readCachedAnalysisStageValue,
  type AnalysisCachedChunkSummaries,
} from "./analysisStageCache";
import { parsePayloadJson, upsertRun } from "./analysisWorkspaceHelpers";
import {
  prepareAnalysisWorkspaceSources,
  resolveAndPreloadAnalysisWorkspaceReferences,
  resolvePaperAnalysisContextReferences,
  type MaterializedAnalysisContext,
} from "./analysisWorkspaceSources";
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
import {
  buildAnalysisResearchPlan,
  buildResearchEvidenceContext,
  initialResearchStages,
  updateResearchStage,
} from "./analysisResearchPlan";
import {
  createResearchProgressUpdater,
  moveResearchToConclusion,
  runAnalysisResearchEvidence,
  saveAnalysisResearchReport,
} from "./analysisResearchWorkflow";
import type { RunAnalysisWorkspacePromptParams } from "./analysisWorkspaceRunner.types";
export type { RunAnalysisWorkspacePromptOptions } from "./analysisWorkspaceRunner.types";
export async function runAnalysisWorkspacePrompt(params: RunAnalysisWorkspacePromptParams) {
  const {
    inputPrompt,
    options,
    suspended,
    projectId,
    activeTaskId,
    selectedFile,
    editorContent,
    referenceFiles,
    structuredDataFiles,
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
    let references = { explicit: false, structuredFiles: [] as string[], contextFiles: [] as string[] };
    let materializedContext: MaterializedAnalysisContext | undefined;
    if (task.sourceType !== "paper") {
      try {
        ({ references, materializedContext } = await resolveAndPreloadAnalysisWorkspaceReferences({
          projectId,
          prompt: normalizedPrompt,
          referenceFiles,
          structuredDataFiles,
          planInputFiles: options?.analysisPlan?.inputFiles,
          t,
        }));
      } catch (error) {
        const message = `${t("analysis.error.failed")}: ${t("analysis.step.loadContext")} · ${String(error)}`;
        updateTaskById(task.id, (item) => ({ ...item, lastError: message, updatedAt: nowIso() }));
        setToast({ type: "error", message });
        runInFlightRef.current = false;
        return;
      }
    }
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
    let researchStages: AnalysisResearchStage[] = [];
    try {
      const setStage = (label: string) => {
        currentStage = label;
        setLiveStageLabel(label);
      };
      const runIds: string[] = [];
      const stageCache = await ensureStageCache();
      const outputLanguage = resolveAnalysisLanguage(normalizedPrompt, locale);
      const outputLanguageLabel = languageLabel(outputLanguage);
      const researchPlan = buildAnalysisResearchPlan({
        prompt: normalizedPrompt,
        sourceType: task.sourceType,
        inputFiles: task.sourceType === "paper"
          ? (task.sourcePath ? [task.sourcePath] : [])
          : references.structuredFiles,
      });
      researchStages = initialResearchStages(researchPlan);
      const nextPendingRun = buildPendingAnalysisRun({
        task,
        prompt: normalizedPrompt,
        outputLanguage,
        researchPlan,
        researchStages,
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
      let snapshots: AnalysisSourceSnapshot[] = [];
      let sourceBlock = "";
      let synthesisFallbackSourceBlock: string | null = null;
      let resolvedInputFiles: string[] = [];
      let resolvedContextFiles: string[] = [];
      const steps: string[] = [
        t("analysis.research.stage.plan"),
        ...(materializedContext ? [t("analysis.step.loadContext")] : []),
      ];
      let academicEvidence: AcademicEvidence[] = [];
      let webEvidence: AcademicEvidence[] = [];
      let providerHealth: AcademicProviderHealth[] = [];
      const updateResearchProgress = createResearchProgressUpdater({
        taskId: task.id,
        runId: pendingRunId,
        researchPlan,
        getStages: () => researchStages,
        updateTaskById,
      });

      setStage(t("analysis.research.stage.evidence"));
      steps.push(currentStage);
      let evidenceResponse: ReferenceCheckResponse | null = null;
      const evidenceOutcome = await runAnalysisResearchEvidence({
        projectId,
        plan: researchPlan,
        stages: researchStages,
        onProgress: (outcome) => {
          researchStages = outcome.stages;
          updateResearchProgress({
            academicEvidence: outcome.academicEvidence,
            webEvidence: outcome.webEvidence,
            providerHealth: outcome.providerHealth,
          });
        },
      });
      evidenceResponse = evidenceOutcome.response;
      researchStages = evidenceOutcome.stages;
      academicEvidence = evidenceOutcome.academicEvidence;
      webEvidence = evidenceOutcome.webEvidence;
      providerHealth = evidenceOutcome.providerHealth;
      researchStages = updateResearchStage(researchStages, "analysis", "running");
      updateResearchProgress();
      steps.push(t("analysis.research.stage.analysis"));
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
        const paperReferences = resolvePaperAnalysisContextReferences(paperContext);
        resolvedInputFiles = paperReferences.inputFiles;
        resolvedContextFiles = paperReferences.contextFiles;
        contextRefs.push(...paperReferences.contextRefs);
      } else {
        const prepared = await prepareAnalysisWorkspaceSources({
          projectId,
          taskId: task.id,
          prompt: normalizedPrompt,
          outputLanguageLabel,
          promptSignature,
          references,
          materializedContext,
          analysisPlan: options?.analysisPlan,
          stageCache,
          persistStageCacheEntry,
          onStage: (stage) => {
            if (stage === "loadContext" && materializedContext) {
              return;
            }
            const key = stage === "loadContext" ? "analysis.step.loadContext" : `analysis.step.${stage}`;
            setStage(t(key));
            steps.push(currentStage);
          },
          t,
        });
        snapshots = prepared.snapshots;
        sourceBlock = prepared.sourceBlock;
        resolvedInputFiles = prepared.inputFiles;
        resolvedContextFiles = prepared.contextFiles;
        contextRefs.push(...prepared.contextRefs);
      }
      if (evidenceResponse) {
        sourceBlock = `${sourceBlock}\n\n---\n\n${buildResearchEvidenceContext(evidenceResponse)}`;
      }
      if (selectedFile && editorContent.trim() && !references.explicit) {
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
      researchStages = moveResearchToConclusion(researchStages, (id, nextStages) => {
        researchStages = nextStages;
        setStage(t(`analysis.research.stage.${id}`));
        steps.push(currentStage);
        updateResearchProgress();
      });
      const completed = buildCompletedAnalysisRun({
        task,
        parsed,
        snapshots,
        outputLanguage,
        resolvedInputFiles,
        resolvedContextFiles,
        eventRunIds: runIds,
        agentRunId: finalResult.runId,
        prompt: normalizedPrompt,
        steps,
        researchPlan,
        researchStages: updateResearchStage(
          researchStages,
          "conclusion",
          "completed",
          "report_persisted",
        ),
        academicEvidence,
        webEvidence,
        providerHealth,
        runId: pendingRunId,
        t,
      });
      const saved = await saveAnalysisResearchReport({
        projectId,
        runId: completed.runRecord.id,
        title: completed.runRecord.title,
        reportHtml: completed.reportHtml,
        chartDataUrl: completed.chartDataUrl,
        academicEvidence,
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
      researchStages = researchStages.map((stage) =>
        stage.status === "running" ? { ...stage, status: "failed", detailCode: "run_stopped" } : stage);
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
              researchStages,
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
            researchStages,
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

