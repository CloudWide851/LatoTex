import type {
  AnalysisAssetInput,
  AnalysisEnvStatus,
  AnalysisExportArtifactResponse,
  AnalysisListReportsResponse,
  AnalysisRunPythonResponse,
  AnalysisSaveReportResponse,
  AnalysisSourceSnapshotInput,
  ReferenceCheckResponse,
} from "../types/app";
import { invokeCommand } from "./core";

export function referenceCheck(
  queries: string[],
  limit = 5,
): Promise<ReferenceCheckResponse> {
  return invokeCommand<ReferenceCheckResponse>("reference_check", {
    input: { queries, limit },
  });
}

export function analysisSaveReport(input: {
  projectId: string;
  runId?: string;
  title?: string;
  reportHtml: string;
  assets?: AnalysisAssetInput[];
}): Promise<AnalysisSaveReportResponse> {
  return invokeCommand<AnalysisSaveReportResponse>("analysis_save_report", {
    input: {
      projectId: input.projectId,
      runId: input.runId,
      title: input.title,
      reportHtml: input.reportHtml,
      assets: input.assets ?? [],
    },
  });
}

export function analysisListReports(projectId: string): Promise<AnalysisListReportsResponse> {
  return invokeCommand<AnalysisListReportsResponse>("analysis_list_reports", {
    input: { projectId },
  });
}

export function analysisExportArtifact(
  projectId: string,
  relativePath: string,
  defaultFileName?: string,
): Promise<AnalysisExportArtifactResponse | null> {
  return invokeCommand<AnalysisExportArtifactResponse | null>("analysis_export_artifact", {
    input: { projectId, relativePath, defaultFileName },
  });
}

export function analysisEnvPrepare(projectId: string): Promise<AnalysisEnvStatus> {
  return invokeCommand<AnalysisEnvStatus>("analysis_env_prepare", {
    input: { projectId },
  });
}

export function analysisEnvStatus(projectId: string): Promise<AnalysisEnvStatus> {
  return invokeCommand<AnalysisEnvStatus>("analysis_env_status", {
    input: { projectId },
  });
}

export function analysisRunPython(input: {
  projectId: string;
  taskId?: string;
  prompt: string;
  outputLanguage: string;
  snapshots: AnalysisSourceSnapshotInput[];
}): Promise<AnalysisRunPythonResponse> {
  return invokeCommand<AnalysisRunPythonResponse>("analysis_run_python", {
    input: {
      projectId: input.projectId,
      taskId: input.taskId,
      prompt: input.prompt,
      outputLanguage: input.outputLanguage,
      snapshots: input.snapshots,
    },
  });
}
