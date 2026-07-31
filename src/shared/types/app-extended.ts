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

export type LibraryCitationIndexIssue = {
  path: string;
  message: string;
};

export type LibraryCitationDuplicateKey = {
  citationKey: string;
  paths: string[];
};

export type LibraryCitationIndexStatus = {
  totalBibFiles: number;
  totalPdfFiles: number;
  indexedEntries: number;
  duplicateKeys: LibraryCitationDuplicateKey[];
  missingBibForPdfs: string[];
  missingPdfForBibs: string[];
  invalidBibFiles: LibraryCitationIndexIssue[];
  indexPath: string;
  updatedAt?: string | null;
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

export type LibraryCitationResolveResult = {
  matchedPath: string;
  matchKind: string;
  summary: LibraryCitationSummary;
  pdfPreview?: LibraryPdfPreview | null;
  diagnostics: string[];
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
  pdfRelativePath: string;
};

export type DrawExportAssetResult = {
  savedPath: string;
  fileName: string;
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

export type BusyTexCacheInfo = {
  policy: "install-first" | "appdata-only" | string;
  actualDir: string;
  ready?: boolean;
  message?: string | null;
};

export type BusyTexInstallPackageResult = {
  styleFile: string;
  overlayFiles: { path: string; content: string }[];
  sourceUrl?: string | null;
};

export type AnalysisPyodideCacheInfo = {
  policy: "install-first" | "appdata-only" | string;
  actualDir: string;
  ready?: boolean;
  message?: string | null;
};

export type DrawioCacheInfo = {
  policy: "install-first" | "appdata-only" | string;
  actualDir: string;
  ready?: boolean;
  message?: string | null;
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
  failure?: NativeRuntimeFailure | null;
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
  uvSource?: "bundled" | "managed" | "path" | string | null;
  pythonPath?: string | null;
  pythonVersion?: string | null;
  pdfMathTranslateVersion?: string | null;
  venvPath: string;
  runtimeRoot: string;
  lastError?: string | null;
  failure?: NativeRuntimeFailure | null;
};

export type NativeRuntimeFailure = {
  code: string;
  stage: string;
  retryable: boolean;
  diagnostics: string[];
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

export type AnalysisMissingValueStrategy = "complete_case" | "report_only";

export type AnalysisPlan = {
  intent: string;
  inputFiles: string[];
  targetColumns: string[];
  groupColumn?: string;
  paired?: boolean;
  missingValueStrategy: AnalysisMissingValueStrategy;
  alpha: number;
};

export type AnalysisNetworkRequirement = "required" | "optional" | "not_needed";

export type AnalysisResearchPlan = {
  intent: string;
  queries: string[];
  inclusionCriteria: string[];
  exclusionCriteria: string[];
  dataChecks: string[];
  expectedValidations: string[];
  networkRequirement: AnalysisNetworkRequirement;
  networkReasonCode: string;
};

export type AnalysisResearchStageId =
  | "plan"
  | "evidence"
  | "analysis"
  | "review"
  | "conclusion";

export type AnalysisResearchStage = {
  id: AnalysisResearchStageId;
  status: "pending" | "running" | "completed" | "skipped" | "failed";
  detailCode?: string;
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

export type AcademicEvidence = {
  stableId: string;
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  doi?: string;
  arxivId?: string;
  openAccess?: boolean;
  pdfUrl?: string;
  landingUrl: string;
  citationCount?: number;
  abstractText?: string;
  source: string;
  evidenceLevel: "metadata" | "abstract" | "fulltext";
  provenance: string[];
  originalSourceUrl: string;
  rrfScore: number;
  /** Compatibility projection for existing consumers. */
  url: string;
  /** Compatibility projection for existing consumers. */
  snippet: string;
};

export type ReferenceEvidence = AcademicEvidence;

export type AcademicProviderFailure = {
  provider: string;
  code: string;
  retryable: boolean;
};

export type AcademicProviderHealth = {
  provider: string;
  category: "academic" | "web" | "local";
  status: "live" | "fresh_cache" | "stale_cache" | "failed" | "circuit_open" | "disabled";
  resultCount: number;
  cacheAgeSeconds?: number;
  code?: string;
  retryable: boolean;
};

export type ReferenceCheckItem = {
  query: string;
  ok: boolean;
  message: string;
  /** Compatibility projection; academic results are listed first. */
  results: ReferenceEvidence[];
  academicResults: ReferenceEvidence[];
  webResults: ReferenceEvidence[];
  providerErrors: AcademicProviderFailure[];
  providerHealth: AcademicProviderHealth[];
  networkUsed: boolean;
};

export type ReferenceCheckResponse = {
  items: ReferenceCheckItem[];
};

export type AcademicSearchResponse = ReferenceCheckResponse;

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
  knowledgeApprovalToken?: string;
};

export type FsOperationResult = {
  ok: boolean;
  message: string;
};

export type ProjectSearchScope = "file_name" | "file_content" | "chat_session";

export type ProjectSearchHit = {
  relativePath?: string | null;
  lineNumber?: number | null;
  matchKind: ProjectSearchScope;
  snippet: string;
  sessionId?: string | null;
  title?: string | null;
};

export type ProjectSearchBatch = {
  hits: ProjectSearchHit[];
  nextCursor?: string | null;
  done: boolean;
  scope?: ProjectSearchScope | null;
};

export type ProjectIntegrityStatus = {
  projectId: string;
  missingRequired: string[];
};

export type GitStatusEntry = {
  path: string;
  previousPath?: string | null;
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
  previousPath?: string | null;
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

export type TelegramProxyMode = "system" | "manual" | "direct";

export type ChannelFailure = {
  code: string;
  stage: string;
  retryable: boolean;
  proxySource: string;
};

export type TelegramConnectionResult = {
  ok: boolean;
  code: string;
  stage: string;
  retryable: boolean;
  proxySource: string;
};

export type TelegramTestInput = {
  text: string;
};

export type TelegramTokenSaveInput = {
  token: string;
};

export type GitInitProgress = {
  phase: "idle" | "checking" | "initializing" | "refreshing" | "done" | "error";
  message: string;
};

