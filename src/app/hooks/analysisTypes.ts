export type AnalysisOutputLanguage = "zh-CN" | "en-US";

export type AnalysisSourceType = "data" | "paper";

export type AnalysisRunStatus = "running" | "completed" | "failed" | "cancelled";

export type AnalysisTaskRun = {
  id: string;
  prompt: string;
  title: string;
  summary: string;
  status: AnalysisRunStatus;
  reportHtml?: string;
  reportRelativePath?: string;
  assetRelativePaths: string[];
  labels: string[];
  values: number[];
  insights: string[];
  steps: string[];
  draftOutputText?: string;
  liveStageLabel?: string;
  failureMessage?: string;
  sourceType: AnalysisSourceType;
  sourcePath?: string;
  inputFiles: string[];
  outputLanguage: AnalysisOutputLanguage;
  agentRunId?: string;
  eventRunIds?: string[];
  createdAt: string;
  updatedAt: string;
};

export type AnalysisTask = {
  id: string;
  name: string;
  sourceType: AnalysisSourceType;
  sourcePath?: string;
  draftPrompt: string;
  lastError: string | null;
  activeRunId?: string;
  createdAt: string;
  updatedAt: string;
  runs: AnalysisTaskRun[];
};

export type AnalysisTaskState = {
  version: 1;
  activeTaskId: string | null;
  tasks: AnalysisTask[];
};

export type AnalysisPreflightQuestion = {
  id: string;
  title: string;
  description: string;
  multiple?: boolean;
  options: Array<{ id: string; label: string; detail?: string }>;
};

export type AnalysisPreflightState = {
  prompt: string;
  questions: AnalysisPreflightQuestion[];
  answers: Record<string, string[]>;
};

export function nowIso(): string {
  return new Date().toISOString();
}

export function newTaskId(prefix = "task"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newRunId(prefix = "run"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
