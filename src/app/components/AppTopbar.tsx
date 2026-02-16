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
    <header className="app-topbar flex h-12 items-center justify-between border-b px-3">
      <div className="flex min-w-0 items-center gap-2">
        <div
          className="flex items-center gap-2 rounded-md border border-slate-300 bg-white px-2 py-1"
          data-tauri-drag-region
        >
          <img src={logoMark} alt={t("app.brand")} className="h-5 w-5 object-contain" />
          <span className="brand-wordmark text-sm tracking-wide text-slate-900">{t("app.brand")}</span>
        </div>
        {status === "offline" && (
          <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[11px] text-amber-300">
            {t("app.offline")}
          </span>
        )}
      </div>

      <div className="mx-3 flex min-w-0 flex-1 items-center gap-2">
        <ProjectSwitcher
          projects={projects}
          activeProjectId={activeProjectId}
          disabled={projects.length === 0}
          onChange={onProjectChange}
          t={t}
        />
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
        <button
          className="app-topbar-field rounded p-1.5"
          onClick={onOpenFolder}
          disabled={busy}
          title={t("topbar.openFolder")}
          aria-label={t("topbar.openFolder")}
        >
          <FolderOpen className="h-4 w-4" />
        </button>
      </div>

      <div className="flex items-center">
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
