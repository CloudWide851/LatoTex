import { GitBranch, RefreshCcw, Upload, Download, Send, Plus, CheckSquare, Square } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import type { GitBranchInfo, GitCommitInfo, GitStatus, GitStatusEntry } from "../../shared/types/app";

type TranslationFn = (key: any) => string;

export function GitWorkspace(props: {
  status: GitStatus | null;
  branches: GitBranchInfo[];
  commits: GitCommitInfo[];
  busy: boolean;
  onRefresh: () => void;
  onFetch: () => void;
  onPull: () => void;
  onPush: () => void;
  onCheckout: (branch: string, create: boolean) => void;
  onStage: (paths: string[]) => void;
  onUnstage: (paths: string[]) => void;
  onCommit: (message: string) => void;
  t: TranslationFn;
}) {
  const {
    status,
    branches,
    commits,
    busy,
    onRefresh,
    onFetch,
    onPull,
    onPush,
    onCheckout,
    onStage,
    onUnstage,
    onCommit,
    t,
  } = props;
  const [message, setMessage] = useState("");
  const [selectedBranch, setSelectedBranch] = useState("");
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);

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
    setSelectedPaths((prev) => (prev.includes(path) ? prev.filter((item) => item !== path) : [...prev, path]));
  };

  if (!status?.isRepo) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white text-sm text-slate-500">
        {t("git.notRepo")}
      </div>
    );
  }

  const renderChanges = (entries: GitStatusEntry[]) => (
    <div className="space-y-1">
      {entries.map((entry) => (
        <button
          key={`${entry.path}-${entry.indexStatus}-${entry.worktreeStatus}`}
          className="flex w-full items-center justify-between rounded-md border border-slate-200 bg-white px-2 py-1 text-left text-xs hover:bg-slate-50"
          onClick={() => togglePath(entry.path)}
        >
          <span className="flex items-center gap-2">
            {selectedPaths.includes(entry.path) ? (
              <CheckSquare className="h-3.5 w-3.5 text-primary-600" />
            ) : (
              <Square className="h-3.5 w-3.5 text-slate-400" />
            )}
            <span className="truncate">{entry.path}</span>
          </span>
          <span className="font-mono text-[10px] text-slate-500">
            {entry.indexStatus}
            {entry.worktreeStatus}
          </span>
        </button>
      ))}
    </div>
  );

  return (
    <div className="grid h-full min-h-0 grid-rows-[44px_minmax(0,1fr)] gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-soft motion-slide-up">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-2">
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <GitBranch className="h-4 w-4" />
          <span>{status.branch}</span>
          {status.upstream && (
            <span className="text-slate-400">
              {status.upstream} {status.ahead > 0 ? `↑${status.ahead}` : ""} {status.behind > 0 ? `↓${status.behind}` : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button className="rounded border border-slate-300 p-1.5 hover:bg-slate-100" title={t("git.refresh")} onClick={onRefresh}>
            <RefreshCcw className="h-3.5 w-3.5" />
          </button>
          <button className="rounded border border-slate-300 p-1.5 hover:bg-slate-100" title={t("git.fetch")} onClick={onFetch}>
            <Download className="h-3.5 w-3.5" />
          </button>
          <button className="rounded border border-slate-300 p-1.5 hover:bg-slate-100" title={t("git.pull")} onClick={onPull}>
            <Download className="h-3.5 w-3.5" />
          </button>
          <button className="rounded border border-slate-300 p-1.5 hover:bg-slate-100" title={t("git.push")} onClick={onPush}>
            <Upload className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="grid min-h-0 grid-cols-[minmax(280px,0.44fr)_minmax(0,1fr)] gap-3">
        <div className="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-2">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
            <Select value={selectedBranch} onChange={(e) => setSelectedBranch(e.target.value)}>
              <option value="">{t("git.selectBranch")}</option>
              {branches.map((branch) => (
                <option key={branch.name} value={branch.name}>
                  {branch.current ? `* ${branch.name}` : branch.name}
                </option>
              ))}
            </Select>
            <Button size="sm" variant="secondary" disabled={!selectedBranch} onClick={() => onCheckout(selectedBranch, false)}>
              {t("git.checkout")}
            </Button>
            <Button size="sm" variant="secondary" disabled={!selectedBranch} onClick={() => onCheckout(selectedBranch, true)}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              {t("git.newBranch")}
            </Button>
          </div>

          <div className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
            <h4 className="text-xs font-semibold text-slate-600">{t("git.commit")}</h4>
            <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t("git.commitPlaceholder")} />
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => onStage(selectedPaths)} disabled={busy}>
                {t("git.stage")}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => onUnstage(selectedPaths)} disabled={busy}>
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
              {renderChanges(unstagedFiles)}
            </div>
            <div className="min-h-0 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-2">
              <h4 className="mb-2 text-xs font-semibold text-slate-600">{t("git.staged")}</h4>
              {renderChanges(stagedFiles)}
            </div>
          </div>
        </div>

        <div className="min-h-0 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-2">
          <h4 className="mb-2 text-xs font-semibold text-slate-600">{t("git.history")}</h4>
          <ul className="space-y-2">
            {commits.map((commit) => (
              <li key={commit.hash} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs">
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
