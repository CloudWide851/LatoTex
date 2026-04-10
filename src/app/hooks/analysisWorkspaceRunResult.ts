import type { AnalysisSourceSnapshot } from "./analysisDataSources";
import type { AnalysisOutputLanguage, AnalysisTask, AnalysisTaskRun } from "./analysisTypes";
import { newRunId, nowIso } from "./analysisTypes";
import {
  buildReportHtml,
  clampChart,
  deriveSections,
  toChartFromSnapshots,
  type AgentAnalysisPayload,
} from "./analysisWorkspaceHelpers";

type TranslationFn = (key: any) => string;

export function buildPendingAnalysisRun(input: {
  task: AnalysisTask;
  prompt: string;
  outputLanguage: AnalysisOutputLanguage;
  runId?: string;
  t: TranslationFn;
}): AnalysisTaskRun {
  const { task, prompt, outputLanguage, runId, t } = input;
  const createdAt = nowIso();
  return {
    id: runId ?? newRunId("analysis-run"),
    prompt,
    title: `${task.name} - ${t("analysis.running")}`,
    summary: "",
    status: "running",
    reportRelativePath: "",
    assetRelativePaths: [],
    labels: [],
    values: [],
    insights: [],
    steps: [],
    draftOutputText: "",
    liveStageLabel: "",
    failureMessage: undefined,
    sourceType: task.sourceType,
    sourcePath: task.sourcePath,
    inputFiles: [],
    outputLanguage,
    agentRunId: undefined,
    eventRunIds: [],
    createdAt,
    updatedAt: createdAt,
  };
}

export function hasStructuredAnalysisOutput(parsed: AgentAnalysisPayload): boolean {
  return Boolean(
    (typeof parsed.title === "string" && parsed.title.trim().length > 0)
    || (typeof parsed.summary === "string" && parsed.summary.trim().length > 0)
    || (Array.isArray(parsed.sections) && parsed.sections.length > 0)
    || (Array.isArray(parsed.insights) && parsed.insights.length > 0),
  );
}

export function buildCompletedAnalysisRun(input: {
  task: AnalysisTask;
  parsed: AgentAnalysisPayload;
  snapshots: AnalysisSourceSnapshot[];
  outputLanguage: AnalysisOutputLanguage;
  resolvedInputFiles: string[];
  eventRunIds: string[];
  agentRunId: string;
  prompt: string;
  steps: string[];
  runId?: string;
  t: TranslationFn;
}): { runRecord: AnalysisTaskRun; reportHtml: string; chartDataUrl: string } {
  const {
    task,
    parsed,
    snapshots,
    outputLanguage,
    resolvedInputFiles,
    eventRunIds,
    agentRunId,
    prompt,
    steps,
    runId,
    t,
  } = input;

  const chartSource = clampChart(
    Array.isArray(parsed.chart)
      ? parsed.chart
          .map((item) => ({ label: String(item.label ?? ""), value: Number(item.value ?? Number.NaN) }))
          .filter((item) => item.label && Number.isFinite(item.value))
      : [],
  );
  const chart = chartSource.length > 0 ? chartSource : toChartFromSnapshots(snapshots);
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
  const runRecordId = runId ?? newRunId("analysis-run");
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

  return {
    reportHtml: report.html,
    chartDataUrl: report.chartDataUrl,
    runRecord: {
      id: runRecordId,
      prompt,
      title: resultTitle,
      summary: resultSummary,
      status: "completed",
      reportRelativePath: "",
      assetRelativePaths: [],
      labels,
      values,
      insights,
      steps: mergedSteps,
      draftOutputText: undefined,
      liveStageLabel: undefined,
      failureMessage: undefined,
      sourceType: task.sourceType,
      sourcePath: task.sourcePath,
      inputFiles: resolvedInputFiles,
      outputLanguage,
      agentRunId,
      eventRunIds: Array.from(new Set(eventRunIds)),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
  };
}

