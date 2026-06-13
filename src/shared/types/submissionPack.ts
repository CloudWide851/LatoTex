export type SubmissionPackIssueSeverity = "error" | "warning" | "info" | string;

export type SubmissionPackIssuePayload = {
  id: string;
  severity: SubmissionPackIssueSeverity;
  count?: number | null;
  detail?: string | null;
};

export type SubmissionPackFile = {
  path: string;
  sizeBytes: number;
};

export type SubmissionPackSkippedFile = {
  path: string;
  reason: string;
};

export type SubmissionPackBuildInput = {
  projectId: string;
  mainPath: string;
  profileId: string;
  gateIssues?: SubmissionPackIssuePayload[];
  compileDiagnostics?: string[];
};

export type SubmissionPackBuildResponse = {
  status: "ready" | "blocked" | string;
  profileId: string;
  manifestPath: string;
  zipPath?: string | null;
  blockers: SubmissionPackIssuePayload[];
  warnings: SubmissionPackIssuePayload[];
  includedFiles: SubmissionPackFile[];
  skippedFiles: SubmissionPackSkippedFile[];
};
