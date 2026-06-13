import { useMemo } from "react";
import { SvgSpinner } from "../../../components/ui/svg-spinner";
import type { GitDiffResponse } from "../../../shared/types/app";
import { VirtualizedList } from "../virtual/VirtualizedList";

type TranslationFn = (key: any) => string;
type DiffLineKind = "added" | "removed" | "context" | "meta";
type DiffRow =
  | { kind: "hunk"; key: string; text: string }
  | { kind: "line"; key: string; lineKind: DiffLineKind; text: string };

function flattenDiff(diff: GitDiffResponse): DiffRow[] {
  return diff.hunks.flatMap((hunk, hunkIndex) => [
    { kind: "hunk" as const, key: `${hunk.header}-${hunkIndex}`, text: hunk.header },
    ...hunk.lines
      .filter((line) => line.text.trim() !== "\\ No newline at end of file")
      .map((line, lineIndex) => ({
        kind: "line" as const,
        key: `${hunkIndex}-${lineIndex}-${line.oldLine ?? ""}-${line.newLine ?? ""}-${line.text}`,
        lineKind: line.kind,
        text: line.text,
      })),
  ]);
}

function rowClass(kind: DiffLineKind) {
  if (kind === "added") {
    return "rounded bg-emerald-50 px-1 font-mono text-[10px] text-emerald-800";
  }
  if (kind === "removed") {
    return "rounded bg-rose-50 px-1 font-mono text-[10px] text-rose-800";
  }
  if (kind === "meta") {
    return "rounded bg-slate-100 px-1 font-mono text-[10px] text-slate-500";
  }
  return "rounded px-1 font-mono text-[10px] text-slate-600";
}

function DiffRowView(props: { row: DiffRow }) {
  const { row } = props;
  if (row.kind === "hunk") {
    return (
      <div className="mb-0.5 mt-1 rounded bg-slate-200/80 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-700 first:mt-0">
        {row.text}
      </div>
    );
  }
  return <div className={rowClass(row.lineKind)}>{row.text}</div>;
}

export function GitDiffViewer(props: {
  active: boolean;
  loading: boolean;
  error: string;
  diff?: GitDiffResponse;
  t: TranslationFn;
}) {
  const { active, loading, error, diff, t } = props;
  const rows = useMemo(() => diff ? flattenDiff(diff) : [], [diff]);

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
    <VirtualizedList
      items={rows}
      estimatedItemHeight={20}
      overscan={24}
      className="h-full min-h-[160px] pr-1"
      contentClassName="space-y-0.5"
      getKey={(row) => row.key}
      renderItem={(row) => <DiffRowView row={row} />}
    />
  );
}
