import { Plus, X } from "lucide-react";
import { tabTitleFromPath } from "./drawWorkspaceUtils";

type TranslationFn = (key: any) => string;

export function DrawWorkspaceTabs(props: {
  tabPaths: string[];
  activePath: string | null;
  renamingPath: string | null;
  renameInput: string;
  busy: boolean;
  status: string;
  onRenameInputChange: (value: string) => void;
  onSelectPath: (path: string) => void;
  onStartRename: (path: string) => void;
  onCancelRename: () => void;
  onCommitRename: (path: string) => void;
  onDeletePath: (path: string) => void;
  onCreateNewTab: () => void;
  t: TranslationFn;
}) {
  const {
    tabPaths,
    activePath,
    renamingPath,
    renameInput,
    busy,
    status,
    onRenameInputChange,
    onSelectPath,
    onStartRename,
    onCancelRename,
    onCommitRename,
    onDeletePath,
    onCreateNewTab,
    t,
  } = props;

  return (
    <header className="flex min-w-0 items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto hide-scrollbar">
        {tabPaths.map((path) => {
          const active = path === activePath;
          const editing = path === renamingPath;
          return (
            <div
              key={path}
              className={`group inline-flex h-8 min-w-0 max-w-[240px] items-center gap-1 rounded-lg border px-2 text-xs ${
                active
                  ? "border-primary-500 bg-primary-50 text-primary-800"
                  : "border-slate-300 bg-slate-50 text-slate-700"
              }`}
            >
              {editing ? (
                <input
                  className="h-6 min-w-0 flex-1 rounded border border-slate-300 bg-white px-1.5 text-xs text-slate-700"
                  value={renameInput}
                  autoFocus
                  onChange={(event) => onRenameInputChange(event.target.value)}
                  onBlur={() => onCommitRename(path)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      onCommitRename(path);
                      return;
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      onCancelRename();
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left"
                  onClick={() => onSelectPath(path)}
                  onDoubleClick={() => onStartRename(path)}
                  title={path}
                >
                  {tabTitleFromPath(path)}
                </button>
              )}
              <button
                type="button"
                className="inline-flex h-5 w-5 items-center justify-center rounded text-slate-400 transition hover:bg-white hover:text-slate-700"
                onClick={() => {
                  if (editing) {
                    onCancelRename();
                    return;
                  }
                  onDeletePath(path);
                }}
                title={t("common.close")}
                aria-label={t("common.close")}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
          onClick={onCreateNewTab}
          disabled={busy}
          title={t("draw.newTab")}
          aria-label={t("draw.newTab")}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="max-w-[34%] truncate rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-500">
        {status || t("draw.waiting")}
      </div>
    </header>
  );
}
