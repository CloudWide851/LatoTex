import { FlaskConical, RefreshCcw, Square, X } from "lucide-react";
import type { TerminalTab, TranslationFn } from "./terminalTypes";

export function TerminalToolbar(props: {
  activeTab: TerminalTab | null;
  busy: boolean;
  onActivate: (tabId: string) => void;
  onRestart: (tabId: string) => void;
  onCancelStart: (tabId: string) => void;
  onStop: (tabId: string) => void;
  t: TranslationFn;
}) {
  const {
    activeTab,
    busy,
    onActivate,
    onRestart,
    onCancelStart,
    onStop,
    t,
  } = props;
  const statusLabel = t(`terminal.status.${activeTab?.status ?? "idle"}`);
  const failureStageLabel = activeTab?.failure
    ? t(`terminal.stage.${activeTab.failure.stage}`)
    : "";

  return (
    <>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[color:var(--editor-shell-divider)] px-2">
        {activeTab ? (
          <span
            className="min-w-0 flex-1 truncate text-[10px] text-[color:var(--editor-tab-muted)]"
            title={activeTab.cwd || activeTab.title}
          >
            {activeTab.cwd || activeTab.title}
          </span>
        ) : (
          <span className="min-w-0 flex-1" />
        )}
        {activeTab?.envSource ? (
          <span
            className="max-w-48 shrink truncate rounded border border-[color:var(--editor-widget-border)] bg-[color:var(--editor-paper-bg)] px-1.5 py-0.5 text-[10px] text-[color:var(--editor-tab-muted)]"
            title={activeTab.venvPath ?? t("terminal.environment.analysis")}
          >
            {t(`terminal.environment.${activeTab.envSource}`)}
          </span>
        ) : null}
        <span
          className="shrink-0 rounded border border-[color:var(--editor-widget-border)] px-1.5 py-0.5 text-[10px] text-[color:var(--editor-tab-muted)]"
          aria-live="polite"
        >
          {statusLabel}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {activeTab?.sessionId && !activeTab.envSource ? (
            <button
              type="button"
              className="panel-topbar-btn editor-toolbar-btn h-7 w-7"
              onClick={() => onActivate(activeTab.id)}
              disabled={busy || activeTab.status !== "running"}
              title={t("terminal.activateResearchEnv")}
              aria-label={t("terminal.activateResearchEnv")}
            >
              <FlaskConical className="h-4 w-4" />
            </button>
          ) : null}
          <button
            type="button"
            className="panel-topbar-btn editor-toolbar-btn h-7 w-7"
            onClick={() => activeTab && onRestart(activeTab.id)}
            disabled={!activeTab || busy}
            title={t("terminal.restart")}
            aria-label={t("terminal.restart")}
          >
            <RefreshCcw className="h-4 w-4" />
          </button>
          {activeTab?.status === "starting" && activeTab.startRequestId ? (
            <button
              type="button"
              className="panel-topbar-btn editor-toolbar-btn h-7 w-7"
              onClick={() => onCancelStart(activeTab.id)}
              title={t("terminal.cancelStart")}
              aria-label={t("terminal.cancelStart")}
            >
              <X className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              className="panel-topbar-btn editor-toolbar-btn h-7 w-7"
              onClick={() => activeTab && onStop(activeTab.id)}
              disabled={!activeTab?.sessionId}
              title={t("terminal.stop")}
              aria-label={t("terminal.stop")}
            >
              <Square className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      {activeTab?.failure ? (
        <div
          className="flex items-center gap-2 border-b border-rose-300 bg-rose-50 px-2 py-1 text-[11px] text-rose-700"
          role="status"
        >
          <span className="min-w-0 flex-1 truncate">
            {t(activeTab.failure.code)}
          </span>
          {failureStageLabel ? (
            <span className="shrink-0 text-[10px] text-rose-600">
              {failureStageLabel}
            </span>
          ) : null}
          {activeTab.failure.retryable ? (
            <span className="shrink-0 text-[10px] text-rose-600">
              {t("terminal.retrySafe")}
            </span>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
