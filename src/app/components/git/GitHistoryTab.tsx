import { Input } from "../../../components/ui/input";
import type {
  GitCommitFileEntry,
  GitCommitInfo,
  GitDiffResponse,
} from "../../../shared/types/app";
import { SvgSpinner } from "../../../components/ui/svg-spinner";
import { GitDiffViewer } from "./GitDiffViewer";

type TranslationFn = (key: any) => string;

export function GitHistoryTab(props: {
  commits: GitCommitInfo[];
  query: string;
  selectedHash: string;
  commitFiles: GitCommitFileEntry[];
  loadingFiles: boolean;
  filesError: string;
  selectedPath: string;
  activeDiffKey: string | null;
  loadingDiffKey: string | null;
  activeDiff?: GitDiffResponse;
  activeDiffError: string;
  buildDiffKey: (path: string, staged: boolean, revision?: string) => string;
  onQueryChange: (value: string) => void;
  onSelectCommit: (hash: string) => void;
  onSelectFile: (path: string) => Promise<void>;
  t: TranslationFn;
}) {
  const {
    commits,
    query,
    selectedHash,
    commitFiles,
    loadingFiles,
    filesError,
    selectedPath,
    activeDiffKey,
    loadingDiffKey,
    activeDiff,
    activeDiffError,
    buildDiffKey,
    onQueryChange,
    onSelectCommit,
    onSelectFile,
    t,
  } = props;

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(280px,0.36fr)_minmax(0,1fr)] gap-3">
      <aside className="grid min-h-0 grid-rows-[auto_minmax(120px,0.48fr)_minmax(160px,0.52fr)] gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
        <Input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={t("git.historySearchPlaceholder")}
          className="h-8 text-xs"
        />

        <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-1.5 overflow-hidden rounded border border-slate-200 bg-white p-1.5">
          <h4 className="px-1 text-xs font-semibold text-slate-600">{t("git.history")}</h4>
          <div className="min-h-0 space-y-1 overflow-auto">
            {commits.length === 0 ? (
              <div className="px-2 py-2 text-[11px] text-slate-500">{t("preview.none")}</div>
            ) : (
              commits.map((commit) => (
                <button
                  key={commit.hash}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[11px] ${
                    selectedHash === commit.hash
                      ? "bg-primary-50 text-primary-900"
                      : "text-slate-700 hover:bg-slate-100"
                  }`}
                  onClick={() => onSelectCommit(commit.hash)}
                  title={`${commit.shortHash} ${commit.subject}`}
                >
                  <span className="shrink-0 font-mono text-[10px] text-slate-500">{commit.shortHash}</span>
                  <span className="truncate">{commit.subject}</span>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-1.5 overflow-hidden rounded border border-slate-200 bg-white p-1.5">
          <div className="flex items-center justify-between px-1">
            <h4 className="text-xs font-semibold text-slate-600">{t("git.changedFiles")}</h4>
            {loadingFiles ? <SvgSpinner className="h-3.5 w-3.5 text-slate-500" /> : null}
          </div>
          <div className="min-h-0 overflow-auto">
            {filesError ? (
              <div className="rounded border border-rose-300 bg-rose-50 px-2 py-1 text-[11px] text-rose-700">
                {filesError}
              </div>
            ) : commitFiles.length === 0 ? (
              <div className="px-2 py-2 text-[11px] text-slate-500">{t("git.diffEmpty")}</div>
            ) : (
              <div className="space-y-1">
                {commitFiles.map((file) => {
                  const key = buildDiffKey(file.path, false, selectedHash);
                  const active = activeDiffKey === key;
                  const pathLabel = file.previousPath ? `${file.previousPath} -> ${file.path}` : file.path;
                  return (
                    <button
                      key={`${file.path}-${file.status}`}
                      className={`flex w-full items-center justify-between rounded border px-2 py-1 text-left text-[11px] ${
                        active
                          ? "border-primary-300 bg-primary-50 text-primary-900"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                      }`}
                      onClick={() => void onSelectFile(file.path)}
                      title={pathLabel}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="font-mono text-[10px]">{file.status}</span>
                        <span className="truncate">{pathLabel}</span>
                      </div>
                      <div className="ml-2 flex shrink-0 items-center gap-1 font-mono text-[10px]">
                        <span className="text-emerald-600">+{file.addedLines}</span>
                        <span className="text-rose-600">-{file.removedLines}</span>
                        {loadingDiffKey === key ? <SvgSpinner className="h-3 w-3 text-slate-500" /> : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </aside>

      <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-slate-600">{t("git.diff")}</h4>
          {selectedPath ? (
            <span className="truncate text-[11px] text-slate-500" title={selectedPath}>
              {selectedPath}
            </span>
          ) : null}
        </div>
        <div className="min-h-0 overflow-auto rounded border border-slate-200 bg-white p-2">
          <GitDiffViewer
            active={Boolean(activeDiffKey)}
            loading={Boolean(activeDiffKey && loadingDiffKey === activeDiffKey)}
            error={activeDiffError}
            diff={activeDiff}
            t={t}
          />
        </div>
      </section>
    </div>
  );
}
