import {
  Copy,
  FolderOpen,
  Maximize2,
  Minimize2,
  Minus,
  RefreshCcw,
  Share2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import type { ProjectSearchHit, ProjectSummary, ShareSessionInfo } from "../../shared/types/app";
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
  selectedFile: string | null;
  shareSession: ShareSessionInfo | null;
  shareBusy: boolean;
  shareSyncing: boolean;
  onShareStart: () => void | Promise<void>;
  onShareStop: () => void | Promise<void>;
  onShareRefresh: () => void | Promise<void>;
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
    selectedFile,
    shareSession,
    shareBusy,
    shareSyncing,
    onShareStart,
    onShareStop,
    onShareRefresh,
    t,
  } = props;
  const [sharePanelOpen, setSharePanelOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const shareActive = Boolean(shareSession?.active);
  const primaryShareLink = shareSession?.tunnelUrl || shareSession?.localUrl || "";
  const isTexSelected = Boolean(selectedFile && selectedFile.toLowerCase().endsWith(".tex"));
  const shareActionLabel = shareActive ? t("share.stop") : t("share.start");
  const statusLabel = useMemo(() => {
    if (shareBusy) {
      return t("topbar.searching");
    }
    if (shareSyncing) {
      return `${t("agent.statusRunning")} / CRDT`;
    }
    return "";
  }, [shareBusy, shareSyncing, t]);

  useEffect(() => {
    if (!sharePanelOpen || !primaryShareLink) {
      setQrDataUrl("");
      return;
    }
    void QRCode.toDataURL(primaryShareLink, { width: 168, margin: 1 })
      .then((url) => setQrDataUrl(url))
      .catch(() => setQrDataUrl(""));
  }, [primaryShareLink, sharePanelOpen]);

  return (
    <header className="app-topbar relative grid h-12 grid-cols-[minmax(0,1fr)_minmax(420px,760px)_minmax(0,1fr)] items-center border-b px-3">
      <div className="flex min-w-0 items-center gap-2 justify-self-start">
        <div
          className="brand-badge flex items-center gap-2 rounded-md px-2 py-1"
          data-tauri-drag-region
        >
          <img src={logoMark} alt={t("app.brand")} className="h-5 w-5 object-contain" />
          <span className="brand-wordmark text-base leading-none text-slate-900">{t("app.brand")}</span>
        </div>
        {status === "offline" && (
          <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[11px] text-amber-300">
            {t("app.offline")}
          </span>
        )}
      </div>

      <div className="mx-3 flex min-w-0 w-full items-center gap-2 justify-self-center">
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
        <button
          className="app-topbar-field rounded p-1.5"
          onClick={() => setSharePanelOpen((prev) => !prev)}
          disabled={shareBusy}
          title={t("share.openPanel")}
          aria-label={t("share.openPanel")}
        >
          <Share2 className="h-4 w-4" />
        </button>
      </div>

      <div className="flex items-center justify-self-end">
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

      {sharePanelOpen && (
        <section className="absolute right-4 top-12 z-50 w-[min(420px,96vw)] rounded-lg border border-slate-300 bg-white p-3 shadow-soft">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">{t("share.panelTitle")}</h3>
            <button
              className="rounded border border-slate-300 p-1 text-slate-600 hover:bg-slate-100"
              onClick={() => setSharePanelOpen(false)}
              aria-label={t("common.cancel")}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {statusLabel ? (
            <p className="mb-2 text-[11px] text-emerald-700">{statusLabel}</p>
          ) : null}

          {!shareActive ? (
            <>
              <p className="text-xs text-slate-600">{t("share.inactiveHint")}</p>
              <div className="mt-3 flex items-center gap-2">
                <button
                  className="rounded border border-primary-600 bg-primary-600 px-3 py-1.5 text-xs text-white transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-55"
                  disabled={shareBusy || !isTexSelected}
                  onClick={() => void onShareStart()}
                >
                  {shareActionLabel}
                </button>
                {!isTexSelected ? (
                  <span className="text-[11px] text-rose-600">{t("share.startNeedTex")}</span>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1 text-xs text-slate-700">
                <div className="rounded border border-slate-200 bg-slate-50 p-2">
                  <strong>{t("share.localLink")}:</strong>
                  <div className="mt-1 break-all">{shareSession?.localUrl || "-"}</div>
                </div>
                <div className="rounded border border-slate-200 bg-slate-50 p-2">
                  <strong>{t("share.publicLink")}:</strong>
                  <div className="mt-1 break-all">{shareSession?.tunnelUrl || "-"}</div>
                </div>
                <div className="rounded border border-slate-200 bg-slate-50 p-2">
                  <strong>{t("share.password")}:</strong> {shareSession?.password || "-"}
                </div>
                <div className="rounded border border-slate-200 bg-slate-50 p-2">
                  <strong>{t("share.expiresAt")}:</strong> {shareSession?.expiresAt || "-"}
                </div>
              </div>

              <div className="mt-2 flex items-center gap-2">
                <button
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                  disabled={shareBusy || !primaryShareLink}
                  onClick={() => void navigator.clipboard?.writeText(primaryShareLink)}
                >
                  <Copy className="mr-1 inline h-3 w-3" />
                  {t("share.copyLink")}
                </button>
                <button
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                  disabled={shareBusy}
                  onClick={() => void onShareRefresh()}
                >
                  <RefreshCcw className="mr-1 inline h-3 w-3" />
                  {t("common.refresh")}
                </button>
                <button
                  className="rounded border border-rose-600 bg-rose-600 px-2 py-1 text-xs text-white hover:bg-rose-700 disabled:opacity-60"
                  disabled={shareBusy}
                  onClick={() => void onShareStop()}
                >
                  {t("share.stop")}
                </button>
              </div>

              {qrDataUrl ? (
                <div className="mt-3 flex items-start gap-3 rounded border border-slate-200 bg-slate-50 p-2">
                  <img src={qrDataUrl} alt="share qr" className="h-28 w-28 rounded bg-white p-1" />
                  <p className="text-[11px] leading-5 text-slate-600">{t("share.qrHint")}</p>
                </div>
              ) : null}
            </>
          )}
        </section>
      )}
    </header>
  );
}
