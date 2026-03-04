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
  const activeRunId = typeof input.activeRunId === "string" && input.activeRunId.trim()
    ? input.activeRunId.trim()
    : undefined;
  const runs = Array.isArray(input.runs) ? input.runs : [];
  return {
    id,
    name,
    sourceType,
    sourcePath,
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
  const activeTaskId = typeof parsed.activeTaskId === "string" && parsed.activeTaskId.trim()
    ? parsed.activeTaskId
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
    createdAt,
    updatedAt: createdAt,
    runs: [],
  };
}

export async function loadAnalysisTaskState(
  projectId: string,
  defaultTaskName: string,
): Promise<AnalysisTaskState> {
  try {
    const file = await readFile(projectId, TASK_STORE_PATH);
    const parsed = JSON.parse(file.content) as unknown;
    const state = sanitizeState(parsed);
    if (state.tasks.length > 0) {
      return state;
    }
  } catch {
    // ignore missing or malformed file and create default
  }
  const defaultTask = createDefaultTask(defaultTaskName);
  return {
    version: 1,
    activeTaskId: defaultTask.id,
    tasks: [defaultTask],
  };
}

export async function saveAnalysisTaskState(
  projectId: string,
  state: AnalysisTaskState,
): Promise<void> {
  const normalized = sanitizeState(state);
  await writeFile(projectId, TASK_STORE_PATH, `${JSON.stringify(normalized, null, 2)}\n`);
}
