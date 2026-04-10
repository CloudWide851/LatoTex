import { readFile, writeFile } from "../../shared/api/workspace";
import type { AnalysisRunStatus, AnalysisTask, AnalysisTaskRun, AnalysisTaskState } from "./analysisTypes";
import { nowIso, newTaskId } from "./analysisTypes";

const TASK_STORE_PATH = ".latotex/analysis/tasks.json";

function normalizeRun(input: unknown): AnalysisTaskRun | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const run = input as Partial<AnalysisTaskRun>;
  const id = typeof run.id === "string" ? run.id.trim() : "";
  if (!id) {
    return null;
  }
  const createdAt = typeof run.createdAt === "string" && run.createdAt ? run.createdAt : nowIso();
  const updatedAt = typeof run.updatedAt === "string" && run.updatedAt ? run.updatedAt : createdAt;
  const status = ((): AnalysisRunStatus => {
    if (run.status === "running" || run.status === "failed" || run.status === "cancelled") {
      return run.status;
    }
    return "completed";
  })();
  return {
    id,
    prompt: typeof run.prompt === "string" ? run.prompt : "",
    title: typeof run.title === "string" && run.title.trim() ? run.title.trim() : "Analysis Run",
    summary: typeof run.summary === "string" ? run.summary : "",
    status,
    reportHtml: undefined,
    reportRelativePath: typeof run.reportRelativePath === "string" && run.reportRelativePath.trim()
      ? run.reportRelativePath.trim()
      : undefined,
    assetRelativePaths: Array.isArray(run.assetRelativePaths)
      ? run.assetRelativePaths.map((item) => String(item))
      : [],
    labels: Array.isArray(run.labels) ? run.labels.map((item) => String(item)) : [],
    values: Array.isArray(run.values) ? run.values.map((item) => Number(item)) : [],
    insights: Array.isArray(run.insights) ? run.insights.map((item) => String(item)) : [],
    steps: Array.isArray(run.steps) ? run.steps.map((item) => String(item)) : [],
    draftOutputText: typeof run.draftOutputText === "string" ? run.draftOutputText : undefined,
    liveStageLabel: typeof run.liveStageLabel === "string" ? run.liveStageLabel : undefined,
    failureMessage: typeof run.failureMessage === "string" ? run.failureMessage : undefined,
    sourceType: run.sourceType === "paper" ? "paper" : "data",
    sourcePath: typeof run.sourcePath === "string" && run.sourcePath.trim() ? run.sourcePath : undefined,
    inputFiles: Array.isArray(run.inputFiles) ? run.inputFiles.map((item) => String(item)) : [],
    outputLanguage: run.outputLanguage === "zh-CN" ? "zh-CN" : "en-US",
    agentRunId: typeof run.agentRunId === "string" && run.agentRunId.trim() ? run.agentRunId : undefined,
    eventRunIds: Array.isArray(run.eventRunIds) ? run.eventRunIds.map((item) => String(item)) : undefined,
    createdAt,
    updatedAt,
  };
}

function normalizeTask(input: Partial<AnalysisTask>): AnalysisTask | null {
  const id = typeof input.id === "string" ? input.id.trim() : "";
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!id || !name) {
    return null;
  }
  const createdAt = typeof input.createdAt === "string" && input.createdAt ? input.createdAt : nowIso();
  const updatedAt = typeof input.updatedAt === "string" && input.updatedAt ? input.updatedAt : createdAt;
  const sourceType = input.sourceType === "paper" ? "paper" : "data";
  const sourcePath = typeof input.sourcePath === "string" && input.sourcePath.trim() ? input.sourcePath : undefined;
  const draftPrompt = typeof input.draftPrompt === "string" ? input.draftPrompt : "";
  const lastError = typeof input.lastError === "string"
    ? input.lastError
    : input.lastError === null
      ? null
      : null;
  const activeRunId = typeof input.activeRunId === "string" && input.activeRunId.trim()
    ? input.activeRunId.trim()
    : undefined;
  const runs = Array.isArray(input.runs)
    ? input.runs
        .map((item) => normalizeRun(item))
        .filter((item): item is AnalysisTaskRun => Boolean(item))
    : [];
  return {
    id,
    name,
    sourceType,
    sourcePath,
    draftPrompt,
    lastError,
    activeRunId,
    createdAt,
    updatedAt,
    runs,
  };
}

function sanitizeState(input: unknown): AnalysisTaskState {
  const parsed = (input && typeof input === "object" ? input : {}) as Partial<AnalysisTaskState>;
  const tasks = Array.isArray(parsed.tasks)
    ? parsed.tasks
        .map((item) => normalizeTask(item as Partial<AnalysisTask>))
        .filter((item): item is AnalysisTask => Boolean(item))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    : [];
  const candidateActiveTaskId = typeof parsed.activeTaskId === "string" && parsed.activeTaskId.trim()
    ? parsed.activeTaskId.trim()
    : null;
  const activeTaskId = candidateActiveTaskId && tasks.some((item) => item.id === candidateActiveTaskId)
    ? candidateActiveTaskId
    : tasks[0]?.id ?? null;
  return {
    version: 1,
    activeTaskId,
    tasks,
  };
}

export function createDefaultTask(name: string): AnalysisTask {
  const createdAt = nowIso();
  return {
    id: newTaskId("analysis"),
    name,
    sourceType: "data",
    draftPrompt: "",
    lastError: null,
    createdAt,
    updatedAt: createdAt,
    runs: [],
  };
}

export async function loadAnalysisTaskState(
  projectId: string,
): Promise<AnalysisTaskState> {
  try {
    const file = await readFile(projectId, TASK_STORE_PATH);
    const parsed = JSON.parse(file.content) as unknown;
    return sanitizeState(parsed);
  } catch {
    // ignore missing or malformed file and create empty state
  }
  return {
    version: 1,
    activeTaskId: null,
    tasks: [],
  };
}

export async function saveAnalysisTaskState(
  projectId: string,
  state: AnalysisTaskState,
): Promise<void> {
  const normalized = sanitizeState(state);
  const lean = {
    ...normalized,
    tasks: normalized.tasks.map((task) => ({
      ...task,
      runs: task.runs.map((run) => ({
        ...run,
        reportHtml: undefined,
      })),
    })),
  };
  await writeFile(projectId, TASK_STORE_PATH, `${JSON.stringify(lean, null, 2)}\n`);
}

