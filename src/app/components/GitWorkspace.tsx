import {
  Download,
  GitBranch,
  Plus,
  RefreshCcw,
  Send,
  Upload,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { GitChangeList } from "./GitChangeList";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { SvgSpinner } from "../../components/ui/svg-spinner";
import type {
  GitAvailability,
  GitBranchInfo,
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
    onOpenFile,
    onStartGitInstall,
    onCancelDownload,
    onRunInstaller,
    t,
  } = props;
  const [message, setMessage] = useState("");
  const [selectedBranch, setSelectedBranch] = useState("");
  const [excludedPaths, setExcludedPaths] = useState<string[]>([]);
  const [activeDiffKey, setActiveDiffKey] = useState<string | null>(null);
  const [activeDiffMeta, setActiveDiffMeta] = useState<{ path: string; staged: boolean } | null>(null);
  const [loadingDiffKey, setLoadingDiffKey] = useState<string | null>(null);
  const [diffByKey, setDiffByKey] = useState<Record<string, GitDiffResponse>>({});
  const [diffErrorByKey, setDiffErrorByKey] = useState<Record<string, string>>({});
  const [historyQuery, setHistoryQuery] = useState("");
  const [selectedHistoryHash, setSelectedHistoryHash] = useState("");
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [actionError, setActionError] = useState("");

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

  const togglePath = (path: string) => {
    setExcludedPaths((prev) =>
      prev.includes(path) ? prev.filter((item) => item !== path) : [...prev, path],
    );
  };

  useEffect(() => {
    setExcludedPaths((prev) => prev.filter((path) => changedPathSet.has(path)));
  }, [changedPathSet]);

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
              {downloadStatus.error && (
                <p className="text-rose-600">{downloadStatus.error}</p>
              )}
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
          {initProgress?.message && (
            <div className="text-xs text-slate-500">{initProgress.message}</div>
          )}
          <Button size="sm" onClick={onInitRepo} disabled={busy || initRunning}>
            <GitBranch className="mr-2 h-4 w-4" />
            {initRunning ? (
              <span className="inline-flex items-center gap-2">
                <SvgSpinner className="h-3.5 w-3.5 text-white" />
                {t("git.initRepo")}
              </span>
            ) : (
              t("git.initRepo")
            )}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 grid-rows-[44px_minmax(0,1fr)] gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-soft motion-slide-up">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-2">
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <GitBranch className="h-4 w-4" />
          <span>{status.branch}</span>
          {availability?.version && <span className="text-slate-400">{availability.version}</span>}
          {status.upstream && (
            <span className="text-slate-400">
              {status.upstream} {status.ahead > 0 ? `↑${status.ahead}` : ""}{" "}
              {status.behind > 0 ? `↓${status.behind}` : ""}
            </span>
          )}
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

      <div className="grid min-h-0 grid-cols-[minmax(280px,0.44fr)_minmax(0,1fr)] gap-3">
        <div className="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-2">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
            <Select
              value={selectedBranch}
              uiSize="sm"
              onChange={(e) => setSelectedBranch(e.target.value)}
            >
              <option value="">{t("git.selectBranch")}</option>
              {branches.map((branch) => (
                <option key={branch.name} value={branch.name}>
                  {branch.current ? `* ${branch.name}` : branch.name}
                </option>
              ))}
            </Select>
            <Button
              size="sm"
              variant="secondary"
              disabled={!selectedBranch}
              onClick={() => onCheckout(selectedBranch, false)}
            >
              {t("git.checkout")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!selectedBranch}
              onClick={() => onCheckout(selectedBranch, true)}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              {t("git.newBranch")}
            </Button>
          </div>

          <div className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
            <h4 className="text-xs font-semibold text-slate-600">{t("git.commit")}</h4>
            <p className="text-[11px] text-slate-500">{t("git.defaultIncludeHint")}</p>
            <Input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t("git.commitPlaceholder")}
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setActionError("");
                  const paths = includedUnstagedPaths;
                  if (paths.length === 0) {
                    return;
                  }
                  if (paths.length === unstagedFiles.length) {
                    void Promise.resolve(onStage([])).catch((error) =>
                      setActionError(error instanceof Error ? error.message : String(error)),
                    );
                    return;
                  }
                  void Promise.resolve(onStage(paths)).catch((error) =>
                    setActionError(error instanceof Error ? error.message : String(error)),
                  );
                }}
                disabled={busy || includedUnstagedPaths.length === 0}
              >
                {t("git.stage")}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setActionError("");
                  const paths = includedStagedPaths;
                  if (paths.length === 0) {
                    return;
                  }
                  if (paths.length === stagedFiles.length) {
                    void Promise.resolve(onUnstage([])).catch((error) =>
                      setActionError(error instanceof Error ? error.message : String(error)),
                    );
                    return;
                  }
                  void Promise.resolve(onUnstage(paths)).catch((error) =>
                    setActionError(error instanceof Error ? error.message : String(error)),
                  );
                }}
                disabled={busy || includedStagedPaths.length === 0}
              >
                {t("git.unstage")}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
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
                disabled={busy || summaryBusy || includedPaths.length === 0}
              >
                {summaryBusy ? t("git.generatingSummary") : t("git.aiSummary")}
              </Button>
              <Button
                size="sm"
                onClick={async () => {
                  setActionError("");
                  try {
                    await syncIncludedSelection();
                    await Promise.resolve(onCommit(message));
                  } catch (error) {
                    setActionError(error instanceof Error ? error.message : String(error));
                  }
                }}
                disabled={busy || !message.trim()}
              >
                <Send className="mr-1 h-3.5 w-3.5" />
                {t("git.commit")}
              </Button>
            </div>
            {actionError ? (
              <div className="rounded border border-rose-300 bg-rose-50 px-2 py-1 text-[11px] text-rose-700">
                {actionError}
              </div>
            ) : null}
          </div>

          <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-2 overflow-hidden">
            <div className="min-h-0 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-2">
              <h4 className="mb-2 text-xs font-semibold text-slate-600">{t("git.unstaged")}</h4>
              <GitChangeList
                entries={unstagedFiles}
                staged={false}
                excludedPaths={excludedPaths}
                activeDiffKey={activeDiffKey}
                selectedHistoryHash={selectedHistoryHash}
                loadingDiffKey={loadingDiffKey}
                buildDiffKey={buildDiffKey}
                onTogglePath={togglePath}
                onOpenDiff={openDiff}
                t={t}
              />
            </div>
            <div className="min-h-0 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-2">
              <h4 className="mb-2 text-xs font-semibold text-slate-600">{t("git.staged")}</h4>
              <GitChangeList
                entries={stagedFiles}
                staged
                excludedPaths={excludedPaths}
                activeDiffKey={activeDiffKey}
                selectedHistoryHash={selectedHistoryHash}
                loadingDiffKey={loadingDiffKey}
                buildDiffKey={buildDiffKey}
                onTogglePath={togglePath}
                onOpenDiff={openDiff}
                t={t}
              />
            </div>
          </div>
        </div>

        <div className="grid min-h-0 grid-rows-[minmax(0,1fr)] gap-2">
          <div className="min-h-0 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h4 className="text-xs font-semibold text-slate-600">{t("git.diff")}</h4>
              <div className="flex items-center gap-2">
                <Input
                  value={historyQuery}
                  onChange={(event) => setHistoryQuery(event.target.value)}
                  placeholder={t("git.historySearchPlaceholder")}
                  className="h-8 w-40 text-xs"
                />
                <Select
                  value={selectedHistoryHash}
                  uiSize="sm"
                  className="w-56"
                  onChange={(event) => {
                    const next = event.target.value;
                    setSelectedHistoryHash(next);
                    if (activeDiffMeta) {
                      void openDiff(activeDiffMeta.path, activeDiffMeta.staged, next || undefined);
                    }
                  }}
                >
                  <option value="">{t("git.historyWorkingTree")}</option>
                  {filteredCommits.map((commit) => (
                    <option key={commit.hash} value={commit.hash}>
                      {`${commit.shortHash} ${commit.subject}`}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            {!activeDiffKey ? (
              <div className="rounded border border-slate-300 bg-white px-2 py-1.5 text-[11px] text-slate-600">
                {t("git.selectFileToDiff")}
              </div>
            ) : loadingDiffKey === activeDiffKey ? (
              <div className="flex items-center gap-2 rounded border border-slate-300 bg-white px-2 py-1.5 text-[11px] text-slate-600">
                <SvgSpinner className="h-3.5 w-3.5 text-slate-500" />
                {t("common.loading")}
              </div>
            ) : activeDiffError ? (
              <div className="rounded border border-rose-300 bg-rose-50 px-2 py-1.5 text-[11px] text-rose-700">
                {activeDiffError}
              </div>
            ) : activeDiff?.hunks.length ? (
              activeDiff.hunks.map((hunk, hunkIndex) => (
                <div key={`${hunk.header}-${hunkIndex}`} className="mb-1 last:mb-0">
                  <div className="space-y-0.5">
                    {hunk.lines
                      .filter((line) => line.text.trim() !== "\\ No newline at end of file")
                      .map((line, lineIndex) => (
                      <div
                        key={`${hunkIndex}-${lineIndex}-${line.text}`}
                        className={
                          line.kind === "added"
                            ? "rounded bg-emerald-50 px-1 font-mono text-[10px] text-emerald-800"
                            : line.kind === "removed"
                              ? "rounded bg-rose-50 px-1 font-mono text-[10px] text-rose-800"
                              : "rounded px-1 font-mono text-[10px] text-slate-600"
                        }
                      >
                        {line.text}
                      </div>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded border border-slate-300 bg-white px-2 py-1.5 text-[11px] text-slate-600">
                {t("git.diffEmpty")}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
