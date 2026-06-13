import { SvgSpinner } from "../../../components/ui/svg-spinner";
import type { GitDiffResponse } from "../../../shared/types/app";

type TranslationFn = (key: any) => string;

export function GitDiffViewer(props: {
  active: boolean;
  loading: boolean;
  error: string;
  diff?: GitDiffResponse;
  t: TranslationFn;
}) {
  const { active, loading, error, diff, t } = props;

  if (!active) {
    return (
      <div className="flex h-full min-h-[160px] items-center justify-center rounded-md bg-slate-100/70 px-4 text-sm text-slate-500">
        {t("git.selectFileToDiff")}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded border border-slate-300 bg-white px-2 py-1.5 text-[11px] text-slate-600">
        <SvgSpinner className="h-3.5 w-3.5 text-slate-500" />
        {t("common.loading")}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded border border-rose-300 bg-rose-50 px-2 py-1.5 text-[11px] text-rose-700">
        {error}
      </div>
    );
  }

  if (!diff || diff.hunks.length === 0) {
    return (
      <div className="rounded border border-slate-300 bg-white px-2 py-1.5 text-[11px] text-slate-600">
        {t("git.diffEmpty")}
      </div>
    );
  }

  return (
    <>
      {diff.hunks.map((hunk, hunkIndex) => (
        <div
          key={`${hunk.header}-${hunkIndex}`}
          className="mb-1 [content-visibility:auto] [contain-intrinsic-size:220px] last:mb-0"
        >
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
      ))}
    </>
  );
}
