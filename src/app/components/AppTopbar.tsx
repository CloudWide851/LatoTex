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
    onOpenFolder,
    onWindowControl,
    t,
  } = props;

  return (
    <header
      className="app-topbar tauri-drag-region relative grid min-w-0 grid-cols-[minmax(0,max-content)_minmax(0,1fr)_auto] items-center border-b"
      data-tauri-drag-region
    >
      <div className="absolute inset-x-0 top-0 h-2" data-tauri-drag-region />

      <div className="flex min-w-0 items-center overflow-hidden justify-self-start">
        <div
          className="app-topbar-logo brand-badge flex min-w-0 items-center gap-2 rounded-md px-2 py-1"
          data-tauri-drag-region
        >
          <img src={logoMark} alt={t("app.brand")} className="h-5 w-5 shrink-0 object-contain" />
          <span className="app-topbar-brand-word brand-wordmark truncate text-base leading-none text-slate-900">
            {t("app.brand")}
          </span>
        </div>
        {status === "offline" && (
          <span className="ml-2 rounded bg-amber-500/20 px-2 py-0.5 text-[11px] text-amber-300">
            {t("app.offline")}
          </span>
        )}
      </div>

      <div className="app-topbar-center mx-1 flex min-w-0 w-full items-center overflow-hidden justify-self-center">
        <div className="tauri-no-drag min-w-[112px] max-w-[248px] flex-[1_1_220px]">
          <ProjectSwitcher
            projects={projects}
            activeProjectId={activeProjectId}
            disabled={projects.length === 0}
            onChange={onProjectChange}
            t={t}
          />
        </div>
        <div className="tauri-no-drag min-w-[140px] flex-[2_1_360px]">
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
          type="button"
          className="app-topbar-field app-topbar-action-btn tauri-no-drag shrink-0 rounded"
          onClick={onOpenFolder}
          disabled={busy}
          title={t("topbar.openFolder")}
          aria-label={t("topbar.openFolder")}
        >
          <FolderOpen className="h-4 w-4" />
        </button>
      </div>

      <div className="app-topbar-window-group relative z-20 flex shrink-0 items-center justify-self-end">
        <button
          type="button"
          aria-label={t("window.minimize")}
          className="app-topbar-btn app-topbar-window-btn tauri-no-drag flex items-center justify-center rounded transition disabled:opacity-40"
          onClick={() => onWindowControl("minimize")}
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label={t("window.maximize")}
          className="app-topbar-btn app-topbar-window-btn tauri-no-drag flex items-center justify-center rounded transition disabled:opacity-40"
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
          type="button"
          aria-label={t("window.close")}
          className="app-topbar-btn-close app-topbar-window-btn tauri-no-drag flex items-center justify-center rounded transition disabled:opacity-40"
          onClick={() => onWindowControl("close")}
          disabled={windowActionBusy}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
