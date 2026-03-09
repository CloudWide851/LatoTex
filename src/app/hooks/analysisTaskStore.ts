import { readFile, writeFile } from "../../shared/api/desktop";
import type { AnalysisTask, AnalysisTaskState } from "./analysisTypes";
import { nowIso, newTaskId } from "./analysisTypes";

const TASK_STORE_PATH = ".latotex/analysis/tasks.json";

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
        .filter((item) => item && typeof item === "object")
        .map((item) => {
          const run = item as Record<string, unknown>;
          const eventRunIds = Array.isArray(run.eventRunIds)
            ? run.eventRunIds.map((id) => String(id))
            : undefined;
          return {
            ...run,
            reportHtml: typeof run.reportHtml === "string" ? run.reportHtml : undefined,
            eventRunIds,
          };
        }) as any[]
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
