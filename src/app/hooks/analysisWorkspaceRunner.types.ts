import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { Locale } from "../../i18n";
import type { AgentTeamMode, AnalysisPlan } from "../../shared/types/app";
import type { AnalysisStageCacheStore } from "./analysisStageCache";
import type { AnalysisTask } from "./analysisTypes";

export type RunAnalysisWorkspacePromptOptions = {
  forcedTaskId?: string;
  taskSnapshot?: AnalysisTask;
  savePrompt?: boolean;
  teamMode?: AgentTeamMode;
  analysisPlan?: AnalysisPlan;
  skipPreflight?: boolean;
};

export type RunAnalysisWorkspacePromptParams = {
  inputPrompt: string;
  options?: RunAnalysisWorkspacePromptOptions;
  suspended: boolean;
  projectId: string | null;
  activeTaskId: string | null;
  selectedFile: string | null;
  editorContent: string;
  referenceFiles: string[];
  structuredDataFiles: string[];
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
  setToast: (value: { type: "info" | "error"; message: string }) => void;
  t: (key: any) => string;
};
