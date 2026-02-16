import {
  CheckSquare,
  Download,
  GitBranch,
  Plus,
  RefreshCcw,
  Send,
  Square,
  Upload,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
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
  GitStatusEntry,
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
  onStage: (paths: string[]) => void;
  onUnstage: (paths: string[]) => void;
  onCommit: (message: string) => void;
  onInitRepo: () => void;
  onLoadDiff: (path: string, staged: boolean) => Promise<GitDiffResponse>;
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
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [loadingDiffKey, setLoadingDiffKey] = useState<string | null>(null);
  const [diffByKey, setDiffByKey] = useState<Record<string, GitDiffResponse>>({});
  const [diffErrorByKey, setDiffErrorByKey] = useState<Record<string, string>>({});

  const changedFiles = status?.changes ?? [];
  const stagedFiles = useMemo(
    () => changedFiles.filter((item) => item.indexStatus !== " " && item.indexStatus !== "?"),
    [changedFiles],
  );
  const unstagedFiles = useMemo(
    () => changedFiles.filter((item) => item.worktreeStatus !== " " || item.indexStatus === "?"),
    [changedFiles],
  );

  const togglePath = (path: string) => {
    setSelectedPaths((prev) =>
      prev.includes(path) ? prev.filter((item) => item !== path) : [...prev, path],
    );
  };

  const toggleDiff = async (path: string, staged: boolean) => {
    const key = `${staged ? "s" : "u"}:${path}`;
    if (expandedKey === key) {
      setExpandedKey(null);
      return;
    }
    if (!diffByKey[key]) {
      setLoadingDiffKey(key);
      try {
        setDiffErrorByKey((prev) => ({ ...prev, [key]: "" }));
        const patch = await onLoadDiff(path, staged);
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
    setExpandedKey(key);
  };

  const renderChanges = (entries: GitStatusEntry[], staged: boolean) => (
    <div className="space-y-1">
      {entries.map((entry) => (
        <div
          key={`${entry.path}-${entry.indexStatus}-${entry.worktreeStatus}-${staged ? "staged" : "unstaged"}`}
          className="rounded-md border border-slate-200 bg-white"
        >
          <div className="flex items-center justify-between gap-2 px-2 py-1 text-left text-xs hover:bg-slate-50">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <button
                className="flex h-4 w-4 items-center justify-center"
                onClick={() => togglePath(entry.path)}
              >
                {selectedPaths.includes(entry.path) ? (
                  <CheckSquare className="h-3.5 w-3.5 text-primary-600" />
                ) : (
                  <Square className="h-3.5 w-3.5 text-slate-400" />
                )}
              </button>
              <button
                className="min-w-0 flex-1 truncate text-left text-slate-700 hover:text-primary-700"
                title={entry.path}
                onClick={() => {
                  onOpenFile(entry.path);
                  void toggleDiff(entry.path, staged);
                }}
              >
                {entry.path}
              </button>
            </div>
            <div className="flex items-center gap-1">
              {loadingDiffKey === `${staged ? "s" : "u"}:${entry.path}` ? (
                <SvgSpinner className="h-3 w-3 text-slate-500" />
              ) : null}
              {expandedKey === `${staged ? "s" : "u"}:${entry.path}` ? (
                <span className="rounded border border-primary-200 bg-primary-50 px-1 py-0 text-[9px] text-primary-700">
                  {t("git.diff")}
                </span>
              ) : null}
              <span className="font-mono text-[10px] text-emerald-600">+{entry.addedLines}</span>
              <span className="font-mono text-[10px] text-rose-600">-{entry.removedLines}</span>
            </div>
          </div>
          {expandedKey === `${staged ? "s" : "u"}:${entry.path}` && (
            <div className="max-h-64 overflow-auto border-t border-slate-200 bg-slate-50 px-2 py-1">
              {diffErrorByKey[`${staged ? "s" : "u"}:${entry.path}`] ? (
                <div className="rounded border border-rose-300 bg-rose-50 px-2 py-1.5 text-[11px] text-rose-700">
                  {diffErrorByKey[`${staged ? "s" : "u"}:${entry.path}`]}
                </div>
              ) : diffByKey[`${staged ? "s" : "u"}:${entry.path}`]?.hunks.length ? (
                diffByKey[`${staged ? "s" : "u"}:${entry.path}`].hunks.map((hunk, hunkIndex) => (
                  <div key={`${hunk.header}-${hunkIndex}`} className="mb-1 last:mb-0">
                    <div className="font-mono text-[10px] text-slate-500">{hunk.header}</div>
                    <div className="space-y-0.5">
                      {hunk.lines.map((line, lineIndex) => (
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
          )}
        </div>
      ))}
    </div>
  );

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
            <Input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t("git.commitPlaceholder")}
            />
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => onStage(selectedPaths)} disabled={busy}>
                {t("git.stage")}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onUnstage(selectedPaths)}
                disabled={busy}
              >
                {t("git.unstage")}
              </Button>
              <Button size="sm" onClick={() => onCommit(message)} disabled={busy || !message.trim()}>
                <Send className="mr-1 h-3.5 w-3.5" />
                {t("git.commit")}
              </Button>
            </div>
          </div>

          <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-2 overflow-hidden">
            <div className="min-h-0 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-2">
              <h4 className="mb-2 text-xs font-semibold text-slate-600">{t("git.unstaged")}</h4>
              {renderChanges(unstagedFiles, false)}
            </div>
            <div className="min-h-0 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-2">
              <h4 className="mb-2 text-xs font-semibold text-slate-600">{t("git.staged")}</h4>
              {renderChanges(stagedFiles, true)}
            </div>
          </div>
        </div>

        <div className="min-h-0 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-2">
          <h4 className="mb-2 text-xs font-semibold text-slate-600">{t("git.history")}</h4>
          <ul className="space-y-2">
            {commits.map((commit) => (
              <li
                key={commit.hash}
                className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs"
              >
                <div className="flex items-center justify-between text-slate-500">
                  <span className="font-mono">{commit.shortHash}</span>
                  <span>{commit.date}</span>
                </div>
                <div className="mt-1 font-medium text-slate-700">{commit.subject}</div>
                <div className="mt-1 text-slate-500">{commit.author}</div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
