import { CheckSquare, Square } from "lucide-react";
import { SvgSpinner } from "../../components/ui/svg-spinner";
import { cn } from "../../lib/utils";
import type { GitStatusEntry } from "../../shared/types/app";

type TranslationFn = (key: any) => string;

export function GitChangeList(props: {
  entries: GitStatusEntry[];
  staged: boolean;
  excludedPaths: string[];
  activeDiffKey: string | null;
  selectedHistoryHash: string;
  loadingDiffKey: string | null;
  buildDiffKey: (path: string, staged: boolean, revision?: string) => string;
  onTogglePath: (path: string) => void;
  onOpenDiff: (path: string, staged: boolean) => Promise<void>;
  t: TranslationFn;
}) {
  const {
    entries,
    staged,
    excludedPaths,
    activeDiffKey,
    selectedHistoryHash,
    loadingDiffKey,
    buildDiffKey,
    onTogglePath,
    onOpenDiff,
    t,
  } = props;

  return (
    <div className="space-y-1">
      {entries.map((entry) => (
        <div
          key={`${entry.path}-${entry.indexStatus}-${entry.worktreeStatus}-${staged ? "staged" : "unstaged"}`}
          className="rounded-md border border-slate-200 bg-white shadow-sm"
        >
          <div className="flex items-center justify-between gap-2 px-2 py-1 text-left text-xs hover:bg-slate-50">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <button
                className="flex h-4 w-4 items-center justify-center"
                onClick={() => onTogglePath(entry.path)}
              >
                {excludedPaths.includes(entry.path) ? (
                  <Square className="h-3.5 w-3.5 text-slate-400" />
                ) : (
                  <CheckSquare className="h-3.5 w-3.5 text-primary-600" />
                )}
              </button>
              <button
                className={cn(
                  "min-w-0 flex-1 truncate text-left hover:text-primary-700",
                  activeDiffKey === buildDiffKey(entry.path, staged, selectedHistoryHash || undefined)
                    ? "text-primary-700"
                    : "text-slate-700",
                )}
                title={entry.path}
                onClick={() => {
                  void onOpenDiff(entry.path, staged);
                }}
              >
                {entry.path}
              </button>
            </div>
            <div className="flex items-center gap-1">
              {loadingDiffKey === buildDiffKey(entry.path, staged, selectedHistoryHash || undefined) ? (
                <SvgSpinner className="h-3 w-3 text-slate-500" />
              ) : null}
              {activeDiffKey === buildDiffKey(entry.path, staged, selectedHistoryHash || undefined) ? (
                <span className="rounded border border-primary-200 bg-primary-50 px-1 py-0 text-[9px] text-primary-700">
                  {t("git.diff")}
                </span>
              ) : null}
              <span className="font-mono text-[10px] text-emerald-600">+{entry.addedLines}</span>
              <span className="font-mono text-[10px] text-rose-600">-{entry.removedLines}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
