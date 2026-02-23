import {
  Download,
  GitBranch,
  RefreshCcw,
  Upload,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { GitCommitTab } from "./git/GitCommitTab";
import { GitHistoryTab } from "./git/GitHistoryTab";
import type {
  GitAvailability,
  GitBranchInfo,
  GitCommitFileEntry,
  GitCommitInfo,
  GitDiffResponse,
  GitDownloadStatus,
  GitInitProgress,
  GitStatus,
} from "../../shared/types/app";

type TranslationFn = (key: any) => string;

function formatBytes(bytes: number): string {
  if (bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function GitWorkspace(props: {
  status: GitStatus | null;
  branches: GitBranchInfo[];
  commits: GitCommitInfo[];
  availability: GitAvailability | null;
  downloadStatus: GitDownloadStatus | null;
  initProgress: GitInitProgress | null;
  busy: boolean;
  onRefresh: () => void;
  onFetch: () => void;
  onPull: () => void;
  onPush: () => void;
  onCheckout: (branch: string, create: boolean) => void;
  onStage: (paths: string[]) => Promise<void> | void;
  onUnstage: (paths: string[]) => Promise<void> | void;
  onCommit: (message: string) => Promise<void> | void;
  onGenerateSummary: (includedPaths: string[]) => Promise<string>;
  onInitRepo: () => void;
  onLoadDiff: (path: string, staged: boolean, revision?: string) => Promise<GitDiffResponse>;
  onLoadCommitFiles: (revision: string) => Promise<GitCommitFileEntry[]>;
  onOpenFile: (path: string) => void;
  onStartGitInstall: () => void;
  onCancelDownload: () => void;
  onRunInstaller: () => void;
  t: TranslationFn;
}) {
  const {
    status,
    branches,
    commits,
    availability,
    downloadStatus,
    initProgress,
    busy,
    onRefresh,
    onFetch,
    onPull,
    onPush,
    onCheckout,
    onStage,
    onUnstage,
    onCommit,
    onGenerateSummary,
    onInitRepo,
    onLoadDiff,
    onLoadCommitFiles,
    onOpenFile,
    onStartGitInstall,
    onCancelDownload,
    onRunInstaller,
    t,
  } = props;

  const [activeTab, setActiveTab] = useState<"commit" | "history">("commit");
  const [message, setMessage] = useState("");
  const [selectedBranch, setSelectedBranch] = useState("");
  const [excludedPaths, setExcludedPaths] = useState<string[]>([]);
  const [activeDiffKey, setActiveDiffKey] = useState<string | null>(null);
  const [activeDiffMeta, setActiveDiffMeta] = useState<{ path: string; staged: boolean } | null>(null);
  const [loadingDiffKey, setLoadingDiffKey] = useState<string | null>(null);
  const [diffByKey, setDiffByKey] = useState<Record<string, GitDiffResponse>>({});
  const [diffErrorByKey, setDiffErrorByKey] = useState<Record<string, string>>({});
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  const [historyQuery, setHistoryQuery] = useState("");
  const [selectedHistoryHash, setSelectedHistoryHash] = useState("");
  const [historyFiles, setHistoryFiles] = useState<GitCommitFileEntry[]>([]);
  const [historyFilesBusy, setHistoryFilesBusy] = useState(false);
  const [historyFilesError, setHistoryFilesError] = useState("");
  const [historyFilePath, setHistoryFilePath] = useState("");

  const changedFiles = (status?.changes ?? []).filter((item) => !item.ignored);
  const stagedFiles = useMemo(
    () => changedFiles.filter((item) => item.indexStatus !== " " && item.indexStatus !== "?"),
    [changedFiles],
  );
  const unstagedFiles = useMemo(
    () => changedFiles.filter((item) => item.worktreeStatus !== " " || item.indexStatus === "?"),
    [changedFiles],
  );
  const changedPathSet = useMemo(() => new Set(changedFiles.map((item) => item.path)), [changedFiles]);
  const includedPaths = useMemo(
    () => changedFiles.map((item) => item.path).filter((path) => !excludedPaths.includes(path)),
    [changedFiles, excludedPaths],
  );
  const includedUnstagedPaths = useMemo(
    () => unstagedFiles.map((item) => item.path).filter((path) => !excludedPaths.includes(path)),
    [excludedPaths, unstagedFiles],
  );
  const includedStagedPaths = useMemo(
    () => stagedFiles.map((item) => item.path).filter((path) => !excludedPaths.includes(path)),
    [excludedPaths, stagedFiles],
  );
  const excludedExistingPaths = useMemo(
    () => excludedPaths.filter((path) => changedPathSet.has(path)),
    [changedPathSet, excludedPaths],
  );
  const filteredCommits = useMemo(() => {
    const query = historyQuery.trim().toLowerCase();
    if (!query) {
      return commits;
    }
    return commits.filter((commit) =>
      `${commit.shortHash} ${commit.subject} ${commit.author}`.toLowerCase().includes(query),
    );
  }, [commits, historyQuery]);

  const buildDiffKey = (path: string, staged: boolean, revision?: string) =>
    `${revision?.trim() || "working"}:${staged ? "s" : "u"}:${path}`;

  useEffect(() => {
    setExcludedPaths((prev) => prev.filter((path) => changedPathSet.has(path)));
  }, [changedPathSet]);

  useEffect(() => {
    if (!selectedHistoryHash) {
      setHistoryFiles([]);
      setHistoryFilePath("");
      return;
    }
    let disposed = false;
    setHistoryFilesBusy(true);
    setHistoryFilesError("");
    onLoadCommitFiles(selectedHistoryHash)
      .then((files) => {
        if (disposed) {
          return;
        }
        setHistoryFiles(files);
      })
      .catch((error) => {
        if (disposed) {
          return;
        }
        setHistoryFiles([]);
        setHistoryFilesError(`${t("git.diffLoadFailed")} ${String(error)}`);
      })
      .finally(() => {
        if (!disposed) {
          setHistoryFilesBusy(false);
        }
      });
    return () => {
      disposed = true;
    };
  }, [onLoadCommitFiles, selectedHistoryHash, t]);

  const syncIncludedSelection = async () => {
    const allPaths = changedFiles.map((item) => item.path);
    if (includedPaths.length === 0) {
      if (excludedExistingPaths.length > 0) {
        await Promise.resolve(onUnstage(excludedExistingPaths));
      }
      return;
    }
    if (includedPaths.length === allPaths.length) {
      await Promise.resolve(onStage([]));
    } else {
      await Promise.resolve(onStage(includedPaths));
    }
    if (excludedExistingPaths.length > 0) {
      await Promise.resolve(onUnstage(excludedExistingPaths));
    }
  };

  const openDiff = async (path: string, staged: boolean, revisionOverride?: string) => {
    const revision = revisionOverride?.trim() || selectedHistoryHash.trim() || undefined;
    const key = buildDiffKey(path, staged, revision);
    setActiveDiffMeta({ path, staged });
    setActiveDiffKey(key);
    onOpenFile(path);
    if (!diffByKey[key]) {
      setLoadingDiffKey(key);
      try {
        setDiffErrorByKey((prev) => ({ ...prev, [key]: "" }));
        const patch = await onLoadDiff(path, staged, revision);
        setDiffByKey((prev) => ({ ...prev, [key]: patch }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setDiffErrorByKey((prev) => ({
          ...prev,
          [key]: `${t("git.diffLoadFailed")} ${message}`,
        }));
      } finally {
        setLoadingDiffKey(null);
      }
    }
  };

  const activeDiff = activeDiffKey ? diffByKey[activeDiffKey] : undefined;
  const activeDiffError = activeDiffKey ? diffErrorByKey[activeDiffKey] : "";

  if (availability && !availability.installed) {
    const statusText = downloadStatus?.status ?? "idle";
    const downloading =
      statusText === "downloading" || statusText === "cancelling" || statusText === "installer-started";
    return (
      <div className="grid h-full place-items-center rounded-lg border border-slate-200 bg-white p-6 shadow-soft">
        <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-slate-50 p-4">
          <h3 className="text-sm font-semibold text-slate-800">{t("git.installRequired")}</h3>
          <p className="mt-2 text-xs text-slate-600">{t("git.installHint")}</p>
          {downloadStatus && (
            <div className="mt-3 space-y-2 rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-700">
              <div className="flex items-center justify-between">
                <span>{downloadStatus.fileName}</span>
                <span>{downloadStatus.progressPercent.toFixed(1)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded bg-slate-200">
                <div
                  className="h-full bg-primary-600 transition-all duration-200"
                  style={{ width: `${downloadStatus.progressPercent}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-500">
                <span>
                  {formatBytes(downloadStatus.downloadedBytes)} /{" "}
                  {downloadStatus.totalBytes > 0
                    ? formatBytes(downloadStatus.totalBytes)
                    : t("git.sizeUnknown")}
                </span>
                <span>{formatBytes(downloadStatus.speedBps)}/s</span>
              </div>
              {downloadStatus.error ? <p className="text-rose-600">{downloadStatus.error}</p> : null}
            </div>
          )}
          <div className="mt-4 flex items-center gap-2">
            <Button size="sm" onClick={onStartGitInstall} disabled={busy || downloading}>
              <Download className="mr-2 h-3.5 w-3.5" />
              {t("git.downloadInstaller")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={onCancelDownload}
              disabled={!downloadStatus || !downloading}
            >
              <XCircle className="mr-2 h-3.5 w-3.5" />
              {t("git.cancelDownload")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={onRunInstaller}
              disabled={downloadStatus?.status !== "completed"}
            >
              {t("git.runInstaller")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!status?.isRepo) {
    const initRunning =
      initProgress?.phase === "checking" ||
      initProgress?.phase === "initializing" ||
      initProgress?.phase === "refreshing";
    return (
      <div className="grid h-full place-items-center rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
        <div className="flex flex-col items-center gap-3">
          <div>{t("git.notRepo")}</div>
          {initProgress?.message ? <div className="text-xs text-slate-500">{initProgress.message}</div> : null}
          <Button size="sm" onClick={onInitRepo} disabled={busy || initRunning}>
            <GitBranch className="mr-2 h-4 w-4" />
            {t("git.initRepo")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 grid-rows-[44px_auto_minmax(0,1fr)] gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-soft motion-slide-up">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-2">
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <GitBranch className="h-4 w-4" />
          <span>{status.branch}</span>
          {availability?.version ? <span className="text-slate-400">{availability.version}</span> : null}
          {status.upstream ? (
            <span className="text-slate-400">
              {status.upstream} {status.ahead > 0 ? `↑${status.ahead}` : ""}{" "}
              {status.behind > 0 ? `↓${status.behind}` : ""}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <button
            className="rounded border border-slate-300 p-1.5 hover:bg-slate-100"
            title={t("git.refresh")}
            onClick={onRefresh}
          >
            <RefreshCcw className="h-3.5 w-3.5" />
          </button>
          <button
            className="rounded border border-slate-300 p-1.5 hover:bg-slate-100"
            title={t("git.fetch")}
            onClick={onFetch}
          >
            <Download className="h-3.5 w-3.5" />
          </button>
          <button
            className="rounded border border-slate-300 p-1.5 hover:bg-slate-100"
            title={t("git.pull")}
            onClick={onPull}
          >
            <Download className="h-3.5 w-3.5" />
          </button>
          <button
            className="rounded border border-slate-300 p-1.5 hover:bg-slate-100"
            title={t("git.push")}
            onClick={onPush}
          >
            <Upload className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          className={`rounded border px-2 py-1 text-xs ${
            activeTab === "commit"
              ? "border-primary-500 bg-primary-50 text-primary-900"
              : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
          }`}
          onClick={() => setActiveTab("commit")}
        >
          {t("git.commit")}
        </button>
        <button
          className={`rounded border px-2 py-1 text-xs ${
            activeTab === "history"
              ? "border-primary-500 bg-primary-50 text-primary-900"
              : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
          }`}
          onClick={() => setActiveTab("history")}
        >
          {t("git.history")}
        </button>
      </div>

      <div className="h-full min-h-0">
        {activeTab === "commit" ? (
          <GitCommitTab
            branches={branches}
            selectedBranch={selectedBranch}
            message={message}
            busy={busy}
            summaryBusy={summaryBusy}
            actionError={actionError}
            changedFiles={changedFiles}
            stagedFiles={stagedFiles}
            unstagedFiles={unstagedFiles}
            excludedPaths={excludedPaths}
            includedPaths={includedPaths}
            includedUnstagedPaths={includedUnstagedPaths}
            includedStagedPaths={includedStagedPaths}
            activeDiffKey={activeDiffKey}
            loadingDiffKey={loadingDiffKey}
            selectedHistoryHash={selectedHistoryHash}
            activeDiff={activeDiff}
            activeDiffError={activeDiffError}
            buildDiffKey={buildDiffKey}
            onSelectBranch={setSelectedBranch}
            onMessageChange={setMessage}
            onCheckout={onCheckout}
            onTogglePath={(path) =>
              setExcludedPaths((prev) =>
                prev.includes(path) ? prev.filter((item) => item !== path) : [...prev, path],
              )
            }
            onOpenDiff={openDiff}
            onStageIncluded={async () => {
              setActionError("");
              const paths = includedUnstagedPaths;
              if (paths.length === 0) {
                return;
              }
              try {
                if (paths.length === unstagedFiles.length) {
                  await Promise.resolve(onStage([]));
                } else {
                  await Promise.resolve(onStage(paths));
                }
              } catch (error) {
                setActionError(error instanceof Error ? error.message : String(error));
              }
            }}
            onUnstageIncluded={async () => {
              setActionError("");
              const paths = includedStagedPaths;
              if (paths.length === 0) {
                return;
              }
              try {
                if (paths.length === stagedFiles.length) {
                  await Promise.resolve(onUnstage([]));
                } else {
                  await Promise.resolve(onUnstage(paths));
                }
              } catch (error) {
                setActionError(error instanceof Error ? error.message : String(error));
              }
            }}
            onGenerateSummary={async () => {
              setActionError("");
              setSummaryBusy(true);
              try {
                await syncIncludedSelection();
                const summary = await onGenerateSummary(includedPaths);
                if (summary) {
                  setMessage(summary);
                }
              } catch (error) {
                setActionError(error instanceof Error ? error.message : String(error));
              } finally {
                setSummaryBusy(false);
              }
            }}
            onCommit={async () => {
              setActionError("");
              try {
                await syncIncludedSelection();
                await Promise.resolve(onCommit(message));
                setMessage("");
                setSelectedHistoryHash("");
                if (activeDiffMeta) {
                  await openDiff(activeDiffMeta.path, activeDiffMeta.staged, undefined);
                }
              } catch (error) {
                setActionError(error instanceof Error ? error.message : String(error));
              }
            }}
            t={t}
          />
        ) : (
          <GitHistoryTab
            commits={filteredCommits}
            query={historyQuery}
            selectedHash={selectedHistoryHash}
            commitFiles={historyFiles}
            loadingFiles={historyFilesBusy}
            filesError={historyFilesError}
            selectedPath={historyFilePath}
            activeDiffKey={activeDiffKey}
            loadingDiffKey={loadingDiffKey}
            activeDiff={activeDiff}
            activeDiffError={activeDiffError}
            buildDiffKey={buildDiffKey}
            onQueryChange={setHistoryQuery}
            onSelectCommit={(hash) => {
              setSelectedHistoryHash(hash);
              setHistoryFilePath("");
              setActiveDiffKey(null);
            }}
            onSelectFile={async (path) => {
              setHistoryFilePath(path);
              await openDiff(path, false, selectedHistoryHash);
            }}
            t={t}
          />
        )}
      </div>
    </div>
  );
}
