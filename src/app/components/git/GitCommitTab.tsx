import { Plus, Send } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Select } from "../../../components/ui/select";
import { GitChangeList } from "../GitChangeList";
import { GitDiffViewer } from "./GitDiffViewer";
import type {
  GitBranchInfo,
  GitDiffResponse,
  GitStatusEntry,
} from "../../../shared/types/app";

type TranslationFn = (key: any) => string;

export function GitCommitTab(props: {
  branches: GitBranchInfo[];
  selectedBranch: string;
  message: string;
  busy: boolean;
  summaryBusy: boolean;
  actionError: string;
  changedFiles: GitStatusEntry[];
  stagedFiles: GitStatusEntry[];
  unstagedFiles: GitStatusEntry[];
  excludedPaths: string[];
  includedPaths: string[];
  includedUnstagedPaths: string[];
  includedStagedPaths: string[];
  activeDiffKey: string | null;
  loadingDiffKey: string | null;
  selectedHistoryHash: string;
  activeDiff?: GitDiffResponse;
  activeDiffError: string;
  buildDiffKey: (path: string, staged: boolean, revision?: string) => string;
  onSelectBranch: (value: string) => void;
  onMessageChange: (value: string) => void;
  onCheckout: (branch: string, create: boolean) => void;
  onTogglePath: (path: string) => void;
  onOpenDiff: (path: string, staged: boolean) => Promise<void>;
  onStageIncluded: () => Promise<void>;
  onUnstageIncluded: () => Promise<void>;
  onGenerateSummary: () => Promise<void>;
  onCommit: () => Promise<void>;
  t: TranslationFn;
}) {
  const {
    branches,
    selectedBranch,
    message,
    busy,
    summaryBusy,
    actionError,
    changedFiles,
    stagedFiles,
    unstagedFiles,
    excludedPaths,
    includedPaths,
    includedUnstagedPaths,
    includedStagedPaths,
    activeDiffKey,
    loadingDiffKey,
    selectedHistoryHash,
    activeDiff,
    activeDiffError,
    buildDiffKey,
    onSelectBranch,
    onMessageChange,
    onCheckout,
    onTogglePath,
    onOpenDiff,
    onStageIncluded,
    onUnstageIncluded,
    onGenerateSummary,
    onCommit,
    t,
  } = props;

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(300px,0.42fr)_minmax(0,1fr)] gap-3">
      <div className="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-2">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
          <Select
            value={selectedBranch}
            uiSize="sm"
            onChange={(event) => onSelectBranch(event.target.value)}
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
            onChange={(event) => onMessageChange(event.target.value)}
            placeholder={t("git.commitPlaceholder")}
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void onStageIncluded()}
              disabled={busy || includedUnstagedPaths.length === 0}
            >
              {t("git.stage")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void onUnstageIncluded()}
              disabled={busy || includedStagedPaths.length === 0}
            >
              {t("git.unstage")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void onGenerateSummary()}
              disabled={busy || summaryBusy || includedPaths.length === 0}
            >
              {summaryBusy ? t("git.generatingSummary") : t("git.aiSummary")}
            </Button>
            <Button
              size="sm"
              onClick={() => void onCommit()}
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
              onTogglePath={onTogglePath}
              onOpenDiff={onOpenDiff}
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
              onTogglePath={onTogglePath}
              onOpenDiff={onOpenDiff}
              t={t}
            />
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-col rounded-md border border-slate-200 bg-slate-50 p-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h4 className="text-xs font-semibold text-slate-600">{t("git.diff")}</h4>
          <span className="text-[11px] text-slate-500">
            {includedPaths.length}/{changedFiles.length}
          </span>
        </div>
        <div className="min-h-0 flex-1">
          <GitDiffViewer
            active={Boolean(activeDiffKey)}
            loading={Boolean(activeDiffKey && loadingDiffKey === activeDiffKey)}
            error={activeDiffError}
            diff={activeDiff}
            t={t}
          />
        </div>
      </div>
    </div>
  );
}
