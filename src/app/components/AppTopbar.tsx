import {
  FolderOpen,
  Maximize2,
  Minimize2,
  Minus,
  X,
} from "lucide-react";
import type { ProjectSearchHit, ProjectSummary } from "../../shared/types/app";
import { ProjectSearch } from "./ProjectSearch";
import { ProjectSwitcher } from "./ProjectSwitcher";

type TranslationFn = (key: any) => string;

export function AppTopbar(props: {
  status: "ready" | "offline";
  logoMark: string;
  projects: ProjectSummary[];
  activeProjectId: string | null;
  busy: boolean;
  isTauriRuntime: boolean;
  windowActionBusy: boolean;
  isMaximized: boolean;
  projectSearchQuery: string;
  projectSearchBusy: boolean;
  projectSearchSearched: boolean;
  projectSearchResults: ProjectSearchHit[];
  onProjectChange: (id: string | null) => void;
  onProjectSearchQueryChange: (query: string) => void;
  onProjectSearch: () => void;
  onProjectSearchSelect: (hit: ProjectSearchHit) => void;
  onProjectSearchClear: () => void;
  onProjectDelete: (project: ProjectSummary, mode: "unregister" | "trashRoot") => void;
  onOpenFolder: () => void;
  onWindowControl: (action: "minimize" | "toggle" | "close") => void;
  t: TranslationFn;
}) {
  const {
    status,
    logoMark,
    projects,
    activeProjectId,
    busy,
    isTauriRuntime,
    windowActionBusy,
    isMaximized,
    projectSearchQuery,
    projectSearchBusy,
    projectSearchSearched,
    projectSearchResults,
    onProjectChange,
    onProjectSearchQueryChange,
    onProjectSearch,
    onProjectSearchSelect,
    onProjectSearchClear,
    onProjectDelete,
    onOpenFolder,
    onWindowControl,
    t,
  } = props;

  return (
    <header
      className="app-topbar tauri-drag-region relative flex h-12 min-w-0 items-center gap-2 border-b px-3"
      data-tauri-drag-region
    >
      <div className="flex min-w-[7.5rem] max-w-[15rem] flex-[0_1_15rem] items-center gap-2">
        <div
          className="brand-badge flex min-w-0 items-center gap-2 rounded-md px-2 py-1"
          data-tauri-drag-region
        >
          <img src={logoMark} alt={t("app.brand")} className="h-5 w-5 object-contain" />
          <span className="brand-wordmark truncate text-base leading-none text-slate-900">{t("app.brand")}</span>
        </div>
        {status === "offline" && (
          <span className="shrink-0 rounded bg-amber-500/20 px-2 py-0.5 text-[11px] text-amber-300">
            {t("app.offline")}
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
        <div className="tauri-no-drag min-w-[8rem] max-w-[18rem] flex-[0_1_18rem]">
          <ProjectSwitcher
            projects={projects}
            activeProjectId={activeProjectId}
            disabled={projects.length === 0}
            onChange={onProjectChange}
            onDelete={onProjectDelete}
            t={t}
          />
        </div>
        <div className="tauri-no-drag min-w-[10rem] flex-[1_1_24rem]">
          <ProjectSearch
            query={projectSearchQuery}
            onQueryChange={onProjectSearchQueryChange}
            searching={projectSearchBusy}
            searched={projectSearchSearched}
            results={projectSearchResults}
            onSearch={onProjectSearch}
            onSelect={onProjectSearchSelect}
            onClear={onProjectSearchClear}
            disabled={!activeProjectId}
            t={t}
          />
        </div>
        <button
          className="app-topbar-field tauri-no-drag shrink-0 rounded p-1.5"
          onClick={onOpenFolder}
          disabled={busy}
          title={t("topbar.openFolder")}
          aria-label={t("topbar.openFolder")}
        >
          <FolderOpen className="h-4 w-4" />
        </button>
      </div>

      <div className="tauri-no-drag flex shrink-0 items-center">
        <button
          aria-label={t("window.minimize")}
          className="app-topbar-btn flex h-8 w-10 items-center justify-center rounded transition disabled:opacity-40"
          onClick={() => onWindowControl("minimize")}
          disabled={!isTauriRuntime || windowActionBusy}
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          aria-label={t("window.maximize")}
          className="app-topbar-btn flex h-8 w-10 items-center justify-center rounded transition disabled:opacity-40"
          onClick={() => onWindowControl("toggle")}
          disabled={!isTauriRuntime || windowActionBusy}
        >
          {isMaximized ? (
            <Minimize2 className="h-4 w-4" />
          ) : (
            <Maximize2 className="h-4 w-4" />
          )}
        </button>
        <button
          aria-label={t("window.close")}
          className="app-topbar-btn-close flex h-8 w-10 items-center justify-center rounded transition disabled:opacity-40"
          onClick={() => onWindowControl("close")}
          disabled={!isTauriRuntime || windowActionBusy}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

    </header>
  );
}
