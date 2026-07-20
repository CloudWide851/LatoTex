export type RuntimeLogInfo = {
  sessionLogFile: string;
  logsDir: string;
  runtimeRoot: string;
  installMode: string;
  version: string;
};

export type RuntimeMemorySnapshot = {
  processId: number;
  rssBytes: number;
  privateBytes?: number | null;
  webviewRssBytes?: number | null;
  webviewPrivateBytes?: number | null;
  webviewProcessCount?: number | null;
  totalRssBytes?: number | null;
  totalPrivateBytes?: number | null;
  sampledAt: string;
};

export type RuntimeDiagnosticsBundleExport = {
  path: string;
  fileName: string;
  sizeBytes: number;
  createdAt: string;
};

export type RuntimeLogEntry = {
  timestamp: string;
  level: string;
  message: string;
  raw: string;
};

export type RuntimeLogReadResponse = {
  entries: RuntimeLogEntry[];
};

export type RuntimeLogSession = {
  fileName: string;
  modifiedAt: string;
  sizeBytes: number;
  isCurrent: boolean;
};

export type RuntimeLogSessionListResponse = {
  sessions: RuntimeLogSession[];
};

export type AppBackgroundImage = {
  path: string;
};

export type AppBackgroundImagePayload = {
  path: string;
  mime: string;
  bytes: number[];
};
