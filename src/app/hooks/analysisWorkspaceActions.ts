import { analysisExportArtifact, workspaceRevealInSystem } from "../../shared/api/desktop";
import type { MutableRefObject } from "react";
import type { AnalysisTask } from "./analysisTypes";
import { nowIso } from "./analysisTypes";

type ToastSetter = (toast: { type: "info" | "error"; message: string }) => void;
type TranslationFn = (key: any) => string;

export async function runPaperAnalysisTask(input: {
  sourcePath: string;
  ensureTasksReady: () => Promise<void>;
  runInFlightRef: MutableRefObject<boolean>;
  setToast: ToastSetter;
  t: TranslationFn;
  tasksRef: MutableRefObject<AnalysisTask[]>;
  createTask: (sourceType?: "data" | "paper", sourcePath?: string, name?: string) => AnalysisTask;
  setActiveTaskId: (taskId: string) => void;
  updateTaskById: (taskId: string, updater: (task: AnalysisTask) => AnalysisTask) => void;
  runAnalysisForPrompt: (
    prompt: string,
    options?: { forcedTaskId?: string; taskSnapshot?: AnalysisTask; savePrompt?: boolean },
  ) => Promise<void>;
}) {
  const {
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
  } = input;
  await ensureTasksReady();
  if (runInFlightRef.current) {
    setToast({ type: "info", message: t("analysis.running") });
    return;
  }
  const normalizedPath = sourcePath.replace(/\\/g, "/");
  const existingTask = tasksRef.current.find(
    (item) => item.sourceType === "paper" && (item.sourcePath ?? "").replace(/\\/g, "/") === normalizedPath,
  );
  const task = existingTask ?? createTask(
    "paper",
    normalizedPath,
    `${t("analysis.paperTaskName")}: ${normalizedPath.split("/").pop() || normalizedPath}`,
  );
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
}

export async function exportAnalysisArtifact(projectId: string | null, relativePath: string) {
  if (!projectId) {
    return;
  }
  await analysisExportArtifact(projectId, relativePath);
}

export async function revealAnalysisArtifact(projectId: string | null, relativePath: string) {
  if (!projectId) {
    return;
  }
  await workspaceRevealInSystem(projectId, relativePath);
}
