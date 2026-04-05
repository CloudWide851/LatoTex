export type RuntimeLogReadFilters = {
  limit?: number;
  level?: string;
  keyword?: string;
  fromTime?: string;
  toTime?: string;
  logFileName?: string;
};

export type LibraryCitationSummary = {
  sourcePath: string;
  bibPath?: string | null;
  citationKey?: string | null;
  title?: string | null;
  authors: string[];
  publishedAt?: string | null;
  doi?: string | null;
  arxivId?: string | null;
  source?: string | null;
  urls: string[];
};

export type LibraryPdfPreview = {
  relativePath?: string | null;
  sourceUrl?: string | null;
  cached: boolean;
  cacheState: "ready" | "pending" | "error" | "missing";
  cacheError?: string | null;
  downloadedBytes?: number | null;
  totalBytes?: number | null;
  translatedRelativePath?: string | null;
};

export type LibraryLinkImportResult = {
  ok: boolean;
  message: string;
  relativePath: string;
  pdfPreview: LibraryPdfPreview;
};

export type LibraryPdfImportResult = {
  ok: boolean;
  message: string;
  relativePath: string;
};

export type LibraryPdfResumeResult = {
  queued: number;
  skipped: number;
  failed: number;
};

export type LibraryZoteroSyncResult = {
  relativePath: string;
  entryCount: number;
  totalResults?: number | null;
};

export type LibraryTranslateStartResult = {
  taskId: string;
};

export type LibraryTranslateStatus = {
  taskId: string;
  runId?: string | null;
  status: string;
  currentPage: number;
  totalPages: number;
  stage?: string | null;
  message?: string | null;
  error?: string | null;
  errorCode?: string | null;
  diagnostics?: string[];
  result?: LibraryTranslateResult | null;
};
export type LibraryTranslateResult = {
  relativePath: string;
  sourceKind: string;
  engine: string;
  artifactPaths?: string[];
  detectedLanguage?: string | null;
  extractionEngine?: string | null;
  extractionMode?: string | null;
  refinedBySearch?: boolean;
  glossaryCount?: number;
  translatedPdfRelativePath: string;
  sourcePdfRelativePath: string;
  pageCount: number;
  ocrPageCount: number;
  layoutMode: string;
};

export type LibraryPaperExtractChunk = {
  chunkIndex: number;
  pageStart: number;
  pageEnd: number;
  text: string;
};

export type LibraryPaperExtractResult = {
  sourcePath: string;
  title: string;
  metadataBlock: string;
  chunks: LibraryPaperExtractChunk[];
  pdfRelativePath?: string | null;
  detectedLanguage?: string | null;
  extractionEngine?: string | null;
  extractionMode?: string | null;
  pageCount: number;
  ocrPageCount: number;
};

export type NativeLatexCompileResponse = {
  status: string;
  engine: string;
  diagnostics: string[];
  durationMs: number;
  pdfRelativePath?: string | null;
  logRelativePath?: string | null;
  pdfBytes?: number[] | null;
  usedFallbackFonts: string[];
  recoveredPackages: string[];
};

export type NativeTaskStartResponse = {
  taskId: string;
};

export type AnalysisEnvPrepareTaskStatus = {
  taskId: string;
  status: string;
  stage?: string | null;
  percent: number;
  message?: string | null;
  currentItem?: string | null;
  error?: string | null;
  diagnostics: string[];
  result?: AnalysisEnvStatus | null;
};

export type NativeLatexCompileTaskStatus = {
  taskId: string;
  status: string;
  stage?: string | null;
  percent: number;
  message?: string | null;
  currentItem?: string | null;
  latestLogLine?: string | null;
  error?: string | null;
  diagnostics: string[];
  result?: NativeLatexCompileResponse | null;
};

export type AnalysisEnvStatus = {
  ready: boolean;
  exists: boolean;
  envKey: string;
  managedRoot: string;
  uvPath?: string | null;
  uvVersion?: string | null;
  pythonPath?: string | null;
  pythonVersion?: string | null;
  pdfMathTranslateVersion?: string | null;
  venvPath: string;
  runtimeRoot: string;
  lastError?: string | null;
};

export type AnalysisNumericSeriesItem = {
  label: string;
  value: number;
};

export type AnalysisSourceSnapshotInput = {
  path: string;
  kind: string;
  summary: string;
  excerpt: string;
  rows?: number;
  columns?: number;
  numericSeries?: AnalysisNumericSeriesItem[];
};

export type AnalysisRunPythonResponse = {
  status: string;
  runtimeSource: string;
  pythonPath: string;
  venvPath: string;
  stdout: string;
  stderr: string;
  diagnostics: string[];
  profileJson: Record<string, unknown>;
};
export type CompileRecord = {
  id: string;
  projectId: string;
  mainFile: string;
  status: string;
  diagnostics: string[];
  durationMs: number;
  createdAt: string;
};

export type ReferenceEvidence = {
  title: string;
  url: string;
  snippet: string;
};

export type ReferenceCheckItem = {
  query: string;
  ok: boolean;
  message: string;
  results: ReferenceEvidence[];
};

export type ReferenceCheckResponse = {
  items: ReferenceCheckItem[];
};

export type AnalysisAssetInput = {
  fileName: string;
  dataUrl: string;
};

export type AnalysisSaveReportResponse = {
  runId: string;
  runDir: string;
  reportRelativePath: string;
  assetRelativePaths: string[];
};

export type AnalysisReportItem = {
  runId: string;
  reportRelativePath: string;
  assetRelativePaths: string[];
  updatedAtUnixMs: number;
};

export type AnalysisListReportsResponse = {
  reports: AnalysisReportItem[];
};

export type AnalysisExportArtifactResponse = {
  savedPath: string;
};

export type ModelProtocolInput = {
  id: string;
  displayName: string;
  baseUrl: string;
  apiKey?: string;
};

export type ModelCatalogItemInput = {
  id: string;
  protocolId: string;
  displayName: string;
  requestName: string;
  capabilities?: {
    apiMode?: string;
    reasoningMode?: string;
    autoRepair?: boolean;
  };
};

export type FsScope = "workspace" | "library";
export type FsAction = "create_file" | "create_folder" | "rename" | "copy" | "move" | "delete";

export type FsOperationInput = {
  projectId: string;
  scope: FsScope;
  action: FsAction;
  path: string;
  targetPath?: string;
  content?: string;
};

export type FsOperationResult = {
  ok: boolean;
  message: string;
};

export type ProjectSearchHit = {
  relativePath: string;
  lineNumber: number;
  snippet: string;
};

export type ProjectIntegrityStatus = {
  projectId: string;
  missingRequired: string[];
};

export type GitStatusEntry = {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
  addedLines: number;
  removedLines: number;
  ignored: boolean;
};

export type GitStatus = {
  isRepo: boolean;
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
  changes: GitStatusEntry[];
};

export type GitBranchInfo = {
  name: string;
  current: boolean;
};

export type GitCommitInfo = {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
};

export type GitCommitFileEntry = {
  path: string;
  status: string;
  addedLines: number;
  removedLines: number;
};

export type GitAvailability = {
  installed: boolean;
  version?: string;
};

export type GitDownloadStart = {
  taskId: string;
  fileName: string;
  downloadUrl: string;
};

export type GitDownloadStatus = {
  taskId: string;
  status: string;
  fileName: string;
  downloadedBytes: number;
  totalBytes: number;
  speedBps: number;
  progressPercent: number;
  installerPath: string;
  error?: string;
};

export type GitDiffLine = {
  kind: "added" | "removed" | "context" | "meta";
  oldLine?: number;
  newLine?: number;
  text: string;
};

export type GitDiffHunk = {
  header: string;
  lines: GitDiffLine[];
};

export type GitDiffResponse = {
  path: string;
  staged: boolean;
  addedLines: number;
  removedLines: number;
  hunks: GitDiffHunk[];
};

export type Ack = {
  ok: boolean;
  message: string;
};

export type GitInitProgress = {
  phase: "idle" | "checking" | "initializing" | "refreshing" | "done" | "error";
  message: string;
};

