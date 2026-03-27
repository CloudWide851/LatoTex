import { CheckSquare, Square } from "lucide-react";
import { memo } from "react";
import { SvgSpinner } from "../../components/ui/svg-spinner";
import { cn } from "../../lib/utils";
import type { GitStatusEntry } from "../../shared/types/app";

type TranslationFn = (key: any) => string;

function resolveGitTone(statusChar: string): {
  textClass: string;
  badgeClass: string;
  code: string;
} {
  const code = statusChar.trim() || "M";
  switch (code) {
    case "A":
    case "?":
      return {
        textClass: "text-emerald-700",
        badgeClass: "border-emerald-300 bg-emerald-50 text-emerald-700",
        code,
      };
    case "D":
      return {
        textClass: "text-rose-700",
        badgeClass: "border-rose-300 bg-rose-50 text-rose-700",
        code,
      };
    case "R":
      return {
        textClass: "text-sky-700",
        badgeClass: "border-sky-300 bg-sky-50 text-sky-700",
        code,
      };
    case "U":
      return {
        textClass: "text-violet-700",
        badgeClass: "border-violet-300 bg-violet-50 text-violet-700",
        code,
      };
    default:
      return {
        textClass: "text-amber-700",
        badgeClass: "border-amber-300 bg-amber-50 text-amber-700",
        code,
      };
  }
}

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
      {entries.map((entry) => {
        const diffKey = buildDiffKey(entry.path, staged, selectedHistoryHash || undefined);
        const isActive = activeDiffKey === diffKey;
        const tone = resolveGitTone(
          staged ? entry.indexStatus : (entry.worktreeStatus === " " ? entry.indexStatus : entry.worktreeStatus),
        );
        return (
          <div
            key={`${entry.path}-${entry.indexStatus}-${entry.worktreeStatus}-${staged ? "staged" : "unstaged"}`}
            className={cn(
              "rounded-md border bg-white shadow-sm",
              isActive ? "border-primary-300" : "border-slate-200",
            )}
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
                <span className={cn("rounded border px-1 py-0 font-mono text-[9px]", tone.badgeClass)}>
                  {tone.code}
                </span>
                <button
                  className={cn(
                    "min-w-0 flex-1 truncate text-left",
                    isActive ? "text-primary-700" : tone.textClass,
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
                {loadingDiffKey === diffKey ? (
                  <SvgSpinner className="h-3 w-3 text-slate-500" />
                ) : null}
                {isActive ? (
                  <span className="rounded border border-primary-200 bg-primary-50 px-1 py-0 text-[9px] text-primary-700">
                    {t("git.diff")}
                  </span>
                ) : null}
                <span className="font-mono text-[10px] text-emerald-600">+{entry.addedLines}</span>
                <span className="font-mono text-[10px] text-rose-600">-{entry.removedLines}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
