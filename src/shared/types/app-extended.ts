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
  translatedRelativePath?: string | null;
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
  status: string;
  currentPage: number;
  totalPages: number;
  stage?: string | null;
  message?: string | null;
  error?: string | null;
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

export type AnalysisPyodideCacheInfo = {
  policy: string;
  requestedDir: string;
  actualDir: string;
  installDirWritable: boolean;
  usingFallback: boolean;
};

export type BusyTexCacheInfo = {
  policy: string;
  requestedDir: string;
  actualDir: string;
  installDirWritable: boolean;
  usingFallback: boolean;
  baseUrl?: string | null;
  preferredInitMode?: "worker" | "direct" | null;
};

export type BusyTexInstalledOverlayFile = {
  path: string;
  content: string;
};

export type BusyTexInstallPackageResult = {
  styleFile: string;
  packageName: string;
  installed: boolean;
  fromCache: boolean;
  sourceUrl: string | null;
  cacheDir: string;
  overlayFiles: BusyTexInstalledOverlayFile[];
};

export type DrawioCacheInfo = {
  policy: string;
  requestedDir: string;
  actualDir: string;
  installDirWritable: boolean;
  usingFallback: boolean;
};

export type LocalResourceProbeEntry = {
  key: string;
  policy: string;
  requestedDir?: string | null;
  actualDir?: string | null;
  installDirWritable?: boolean | null;
  usingFallback?: boolean | null;
  baseUrl?: string | null;
  preferredInitMode?: "worker" | "direct" | null;
  ready: boolean;
  missingAssets: string[];
  error?: string | null;
};

export type LocalResourceProbeResponse = {
  busytex: LocalResourceProbeEntry;
  pyodide: LocalResourceProbeEntry;
  drawio: LocalResourceProbeEntry;
};

export type Ack = {
  ok: boolean;
  message: string;
};

export type GitInitProgress = {
  phase: "idle" | "checking" | "initializing" | "refreshing" | "done" | "error";
  message: string;
};





