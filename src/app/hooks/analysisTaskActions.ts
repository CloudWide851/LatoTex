import type { AnalysisSourceType, AnalysisTask } from "./analysisTypes";
import { newTaskId, nowIso } from "./analysisTypes";

export function updateTaskListById(
  tasks: AnalysisTask[],
  taskId: string,
  updater: (task: AnalysisTask) => AnalysisTask,
): AnalysisTask[] {
  return tasks.map((item) => (item.id === taskId ? updater(item) : item));
}

export function createAnalysisTask(options: {
  defaultName: string;
  sourceType?: AnalysisSourceType;
  sourcePath?: string;
  name?: string;
}): AnalysisTask {
  const { defaultName, sourceType = "data", sourcePath, name } = options;
  const createdAt = nowIso();
  return {
    id: newTaskId("analysis"),
    name: (name?.trim() || defaultName).slice(0, 64),
    sourceType,
    sourcePath,
    draftPrompt: "",
    lastError: null,
    runs: [],
    createdAt,
    updatedAt: createdAt,
  };
}

export function renameTaskList(tasks: AnalysisTask[], taskId: string, nextName: string): AnalysisTask[] {
  const normalized = nextName.trim();
  if (!normalized) {
    return tasks;
  }
  return tasks.map((item) =>
    item.id === taskId ? { ...item, name: normalized.slice(0, 64), updatedAt: nowIso() } : item,
  );
}

export function deleteTaskFromList(options: {
  tasks: AnalysisTask[];
  taskId: string;
  activeTaskId: string | null;
}): { tasks: AnalysisTask[]; nextActiveTaskId: string | null } {
  const { tasks, taskId, activeTaskId } = options;
  const next = tasks.filter((item) => item.id !== taskId);
  if (next.length === 0) {
    return { tasks: [], nextActiveTaskId: null };
  }
  if (activeTaskId === taskId) {
    return { tasks: next, nextActiveTaskId: next[0].id };
  }
  const hasActive = activeTaskId ? next.some((item) => item.id === activeTaskId) : false;
  return { tasks: next, nextActiveTaskId: hasActive ? activeTaskId : next[0].id };
}
