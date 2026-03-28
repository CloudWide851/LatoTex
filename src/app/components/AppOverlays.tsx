import type { CSSProperties } from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";
import { Button } from "../../components/ui/button";
import { ModelModal } from "./ModelModal";
import { SettingsBooleanRow } from "./settings/SettingsBooleanRow";
import { normalizeLogLevel, resolveLineTone } from "./logTone";
import type {
  AnalysisEnvPrepareTaskStatus,
  AnalysisEnvStatus,
  AppSettings,
  ModelCatalogItem,
  SwarmEvent,
} from "../../shared/types/app";
import type { DeleteIntent, LogTab, OverlayType, ThemeTransition, Toast } from "../app-config";

type TranslationFn = (key: any) => string;

function tryFormatJson(input: unknown): string | null {
  if (typeof input !== "string") {
    try {
      return JSON.stringify(input, null, 2);
    } catch {
      return null;
    }
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return input;
  }
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return null;
  }
}

function resolveEnvPromptStageLabel(t: TranslationFn, stage?: string | null, fallback?: string | null): string {
  const key = `analysis.envPromptStage.${String(stage || "queued")}`;
  const resolved = String(t(key as any));
  if (resolved !== key) {
    return resolved;
  }
  return String(fallback || stage || "");
}

export function AppOverlays(props: {
  overlay: OverlayType;
  logsTab: LogTab;
  events: SwarmEvent[];
  compileDiagnostics: string[];
  modelModalOpen: boolean;
  modelModalMode: "create" | "edit";
  modelModalInitial: ModelCatalogItem | null;
  settings: AppSettings | null;
  deleteIntent: DeleteIntent;
  deleteDontAskAgain: boolean;
  integrityIssue: { projectId: string; missingRequired: string[] } | null;
  themeTransition: ThemeTransition | null;
  toast: Toast;
  analysisEnvPrompt: {
    envPromptOpen: boolean;
    envPromptBusy: boolean;
    envPromptStatus: AnalysisEnvStatus | null;
    envPromptTaskStatus: AnalysisEnvPrepareTaskStatus | null;
    handleEnvPromptLater: () => void;
    handleEnvPromptPickLocation: () => void;
    handleEnvPromptCreate: () => void;
  };
  onOverlayClose: () => void;
  onLogsTabChange: (tab: LogTab) => void;
  onModelModalClose: () => void;
  onModelSubmit: (payload: {
    protocol: {
      id: string;
      displayName: string;
      baseUrl: string;
      apiKey?: string;
      isNew: boolean;
    };
    model: ModelCatalogItem;
    modelApiKey?: string;
    modelApiKeyChanged: boolean;
  }) => Promise<{ ok: boolean; message?: string }>;
  onGetModelApiKey: (modelId: string) => Promise<string>;
  onDeleteCancel: () => void;
  onDeleteConfirm: () => void;
  onDeleteDontAskChange: (value: boolean) => void;
  onIntegrityCancel: () => void;
  onIntegrityRepair: () => void;
  closeBehaviorDialogOpen: boolean;
  closeBehaviorRemember: boolean;
  closeBehaviorDialogBusy: boolean;
  onCloseBehaviorRememberChange: (value: boolean) => void;
  onCloseBehaviorCancel: () => void;
  onCloseBehaviorConfirm: (behavior: "tray" | "exit") => void;
  t: TranslationFn;
}) {
  const {
    overlay,
    logsTab,
    events,
    compileDiagnostics,
    modelModalOpen,
    modelModalMode,
    modelModalInitial,
    settings,
    deleteIntent,
    deleteDontAskAgain,
    integrityIssue,
    themeTransition,
    toast,
    analysisEnvPrompt,
    onOverlayClose,
    onLogsTabChange,
    onModelModalClose,
    onModelSubmit,
    onGetModelApiKey,
    onDeleteCancel,
    onDeleteConfirm,
    onDeleteDontAskChange,
    onIntegrityCancel,
    onIntegrityRepair,
    closeBehaviorDialogOpen,
    closeBehaviorRemember,
    closeBehaviorDialogBusy,
    onCloseBehaviorRememberChange,
    onCloseBehaviorCancel,
    onCloseBehaviorConfirm,
    t,
  } = props;

  const eventItems = events.length > 0
    ? events
        .slice(-160)
        .reverse()
        .map((event) => {
          const formatted = JSON.stringify(
            {
              createdAt: event.createdAt,
              role: event.role,
              kind: event.kind,
              payload: event.payload,
            },
            null,
            2,
          );
          const signal = `${event.kind} ${event.role} ${formatted}`;
          return {
            text: formatted,
            tone: resolveLineTone(signal),
            level: normalizeLogLevel(event.kind, signal),
          };
        })
    : [];

  const diagnosticsItems = compileDiagnostics.length > 0
    ? compileDiagnostics.map((line) => {
        const formatted = tryFormatJson(line) ?? line;
        return {
          text: formatted,
          tone: resolveLineTone(formatted),
          level: normalizeLogLevel(formatted, formatted),
        };
      })
    : [];
  const envPromptStatus = analysisEnvPrompt.envPromptStatus;
  const envPromptTaskStatus = analysisEnvPrompt.envPromptTaskStatus;
  const envPromptPath = envPromptStatus?.venvPath || envPromptStatus?.managedRoot || "";
  const envPromptActionLabel = envPromptStatus?.exists
    ? t("analysis.envPromptRepair")
    : t("analysis.envPromptCreate");
  const envPromptPercent = Math.max(0, Math.min(100, Math.round(envPromptTaskStatus?.percent ?? 0)));
  const envPromptStageLabel = resolveEnvPromptStageLabel(
    t,
    envPromptTaskStatus?.stage,
    envPromptTaskStatus?.message ?? null,
  );

  return (
    <>
      {overlay === "logs" && (
        <div className="fixed inset-0 z-[430] flex items-center justify-center bg-slate-900/60 p-4 motion-overlay-enter">
          <div className="grid h-[74vh] w-full max-w-4xl grid-rows-[48px_auto_minmax(0,1fr)] overflow-hidden rounded-xl border border-slate-300 bg-white shadow-soft motion-card-pop motion-panel-glow">
            <div className="flex items-center justify-between border-b border-slate-200 px-4">
              <h3 className="text-sm font-semibold text-slate-800">{t("preview.title")}</h3>
              <button className="rounded p-1 text-slate-500 hover:bg-slate-100" onClick={onOverlayClose}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2">
              <button
                className={cn(
                  "rounded-md border px-2.5 py-1 text-xs",
                  logsTab === "events"
                    ? "border-primary-600 bg-primary-600 text-white"
                    : "border-slate-300 bg-white text-slate-600",
                )}
                onClick={() => onLogsTabChange("events")}
              >
                {t("preview.events")}
              </button>
              <button
                className={cn(
                  "rounded-md border px-2.5 py-1 text-xs",
                  logsTab === "status"
                    ? "border-primary-600 bg-primary-600 text-white"
                    : "border-slate-300 bg-white text-slate-600",
                )}
                onClick={() => onLogsTabChange("status")}
              >
                {t("preview.diagnostics")}
              </button>
            </div>
            <div className="overflow-auto bg-slate-950 p-4">
              {logsTab === "events" ? (
                eventItems.length === 0 ? (
                  <div className="text-xs text-slate-300">{t("preview.none")}</div>
                ) : (
                  <ul className="space-y-2 text-xs">
                    {eventItems.map((item, index) => (
                      <li
                        key={`${item.level}-${index}`}
                        className={cn("rounded-lg border px-3 py-2", item.tone.rowClass)}
                      >
                        <div className="mb-1 text-[10px] uppercase tracking-[0.12em]">
                          <span className={cn("inline-flex rounded-full px-2 py-0.5 font-semibold", item.tone.badgeClass)}>
                            {item.level}
                          </span>
                        </div>
                        <pre className={cn("whitespace-pre-wrap break-all font-mono text-[11px] leading-5", item.tone.textClass)}>
                          {item.text}
                        </pre>
                      </li>
                    ))}
                  </ul>
                )
              ) : diagnosticsItems.length === 0 ? (
                <div className="text-xs text-slate-300">{t("preview.none")}</div>
              ) : (
                <ul className="space-y-2 text-xs">
                  {diagnosticsItems.map((item, index) => (
                    <li
                      key={`${item.level}-${index}`}
                      className={cn("rounded-lg border px-3 py-2", item.tone.rowClass)}
                    >
                      <div className="mb-1 text-[10px] uppercase tracking-[0.12em]">
                        <span className={cn("inline-flex rounded-full px-2 py-0.5 font-semibold", item.tone.badgeClass)}>
                          {item.level}
                        </span>
                      </div>
                      <pre className={cn("whitespace-pre-wrap break-all font-mono text-[11px] leading-5", item.tone.textClass)}>
                        {item.text}
                      </pre>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {modelModalOpen && settings && (
        <ModelModal
          open={modelModalOpen}
          mode={modelModalMode}
          initialModel={modelModalInitial}
          protocols={settings.modelProtocols}
          onClose={onModelModalClose}
          onGetModelApiKey={onGetModelApiKey}
          onSubmit={onModelSubmit}
          t={t}
        />
      )}

      {deleteIntent && (
        <div className="fixed inset-0 z-[430] flex items-center justify-center bg-slate-950/62 p-4 motion-overlay-enter">
          <div className="w-full max-w-md rounded-[22px] border border-rose-200 bg-white p-5 shadow-soft motion-card-pop motion-panel-glow">
            <div className="rounded-[18px] border border-rose-100 bg-rose-50/90 px-4 py-3">
              <h3 className="text-sm font-semibold text-rose-900">{t("explorer.deleteConfirmTitle")}</h3>
              <p className="mt-2 break-all rounded-[14px] border border-rose-100 bg-white/90 px-3 py-2 font-mono text-xs text-rose-800 shadow-sm">
                {deleteIntent.path}
              </p>
            </div>
            <SettingsBooleanRow
              label={t("explorer.deleteDontAsk")}
              checked={deleteDontAskAgain}
              tone="danger"
              className="mt-4"
              onCheckedChange={onDeleteDontAskChange}
            />
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={onDeleteCancel}>
                {t("common.cancel")}
              </Button>
              <Button variant="danger" size="sm" onClick={onDeleteConfirm}>
                {t("common.confirm")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {integrityIssue && (
        <div className="fixed inset-0 z-[430] flex items-center justify-center bg-slate-900/55 p-4 motion-overlay-enter">
          <div className="w-full max-w-lg rounded-lg border border-slate-300 bg-white p-4 shadow-soft motion-card-pop motion-panel-glow">
            <h3 className="text-sm font-semibold text-slate-800">{t("workspace.integrityTitle")}</h3>
            <p className="mt-2 text-xs text-slate-600">
              {t("workspace.integrityHint")}
            </p>
            <ul className="mt-3 max-h-48 space-y-1 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
              {integrityIssue.missingRequired.map((item) => (
                <li key={item} className="font-mono">
                  {item}
                </li>
              ))}
            </ul>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={onIntegrityCancel}>
                {t("common.cancel")}
              </Button>
              <Button size="sm" onClick={onIntegrityRepair}>
                {t("workspace.integrityRepair")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {closeBehaviorDialogOpen && (
        <div className="fixed inset-0 z-[430] flex items-center justify-center bg-slate-900/55 p-4 motion-overlay-enter">
          <div className="w-full max-w-md rounded-lg border border-slate-300 bg-white p-4 shadow-soft motion-card-pop motion-panel-glow">
            <h3 className="text-sm font-semibold text-slate-800">
              {t("window.closeConfirmTitle")}
            </h3>
            <p className="mt-2 text-xs text-slate-600">
              {t("window.closeConfirmHint")}
            </p>
            <SettingsBooleanRow
              label={t("window.closeRemember")}
              checked={closeBehaviorRemember}
              disabled={closeBehaviorDialogBusy}
              className="mt-3 rounded-md border-transparent bg-slate-50 p-2 text-xs text-slate-600 shadow-none"
              onCheckedChange={onCloseBehaviorRememberChange}
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onCloseBehaviorConfirm("tray")}
                disabled={closeBehaviorDialogBusy}
              >
                {t("window.closeActionTray")}
              </Button>
              <Button
                size="sm"
                onClick={() => onCloseBehaviorConfirm("exit")}
                disabled={closeBehaviorDialogBusy}
              >
                {t("window.closeActionExit")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={onCloseBehaviorCancel}
                disabled={closeBehaviorDialogBusy}
              >
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {analysisEnvPrompt.envPromptOpen && envPromptStatus && (
        <div className="fixed inset-0 z-[430] flex items-center justify-center bg-slate-900/55 p-4 motion-overlay-enter">
          <div className="w-full max-w-lg rounded-lg border border-slate-300 bg-white p-4 shadow-soft motion-card-pop motion-panel-glow">
            <h3 className="text-sm font-semibold text-slate-800">{t("analysis.envPromptTitle")}</h3>
            <p className="mt-2 text-xs text-slate-600">
              {envPromptStatus.exists ? t("analysis.envPromptRepairHint") : t("analysis.envPromptCreateHint")}
            </p>
            <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                {t("analysis.envPromptPathLabel")}
              </div>
              <div className="mt-1 break-all font-mono text-xs text-slate-700">{envPromptPath}</div>
            </div>
            {envPromptTaskStatus?.status === "running" ? (
              <div className="mt-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate">{envPromptStageLabel || t("analysis.envPromptProgress")}</span>
                  <span className="shrink-0 tabular-nums">{envPromptPercent}%</span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-sky-100">
                  <div
                    className="h-full rounded bg-sky-500 transition-all"
                    style={{ width: `${Math.max(2, envPromptPercent)}%` }}
                  />
                </div>
                <div className="mt-2 break-all text-[11px] text-sky-700">
                  {envPromptTaskStatus.currentItem || envPromptTaskStatus.message || "-"}
                </div>
              </div>
            ) : null}
            {envPromptStatus.lastError && (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {envPromptStatus.lastError}
              </div>
            )}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={analysisEnvPrompt.handleEnvPromptLater}
                disabled={analysisEnvPrompt.envPromptBusy}
              >
                {t("analysis.envPromptLater")}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  void analysisEnvPrompt.handleEnvPromptPickLocation();
                }}
                disabled={analysisEnvPrompt.envPromptBusy}
              >
                {t("analysis.envPromptChooseLocation")}
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  void analysisEnvPrompt.handleEnvPromptCreate();
                }}
                disabled={analysisEnvPrompt.envPromptBusy}
              >
                {envPromptActionLabel}
              </Button>
            </div>
          </div>
        </div>
      )}
      {themeTransition && (
        <div className="theme-ripple-overlay" aria-hidden>
          <div
            className={cn(
              "theme-ripple-surface",
              themeTransition.active && "is-active",
            )}
            style={
              {
                "--ripple-x": `${themeTransition.x}px`,
                "--ripple-y": `${themeTransition.y}px`,
                "--ripple-radius": `${themeTransition.radius}px`,
                "--ripple-color":
                  themeTransition.target === "dark" ? "#0b1220" : "#f3f4f6",
              } as CSSProperties
            }
          />
        </div>
      )}

      {toast && (
        <div
          className={cn(
            "fixed bottom-4 right-4 z-[440] rounded-md px-4 py-2 text-sm text-white shadow-soft motion-card-pop motion-hover-rise",
            toast.type === "info" ? "bg-emerald-600" : "bg-rose-600",
          )}
        >
          {toast.message}
        </div>
      )}
    </>
  );
}








