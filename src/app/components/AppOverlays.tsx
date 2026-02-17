import type { CSSProperties } from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";
import { Button } from "../../components/ui/button";
import { ModelModal } from "./ModelModal";
import type {
  AppSettings,
  ModelCatalogItem,
  ModelProtocol,
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
    modelApiKeyAction: "keep" | "set" | "clear";
  }) => void;
  onProtocolPing: (input: { protocolId: string; baseUrl: string; apiKey?: string }) => Promise<boolean>;
  onDeleteCancel: () => void;
  onDeleteConfirm: () => void;
  onDeleteDontAskChange: (value: boolean) => void;
  onIntegrityCancel: () => void;
  onIntegrityRepair: () => void;
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
    onOverlayClose,
    onLogsTabChange,
    onModelModalClose,
    onModelSubmit,
    onProtocolPing,
    onDeleteCancel,
    onDeleteConfirm,
    onDeleteDontAskChange,
    onIntegrityCancel,
    onIntegrityRepair,
    t,
  } = props;

  return (
    <>
      {overlay === "logs" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4 motion-fade-in">
          <div className="grid h-[72vh] w-full max-w-3xl grid-rows-[48px_auto_minmax(0,1fr)] overflow-hidden rounded-lg border border-slate-300 bg-white shadow-soft">
            <div className="flex items-center justify-between border-b border-slate-200 px-4">
              <h3 className="text-sm font-semibold text-slate-800">{t("preview.title")}</h3>
              <button className="rounded p-1 text-slate-500 hover:bg-slate-100" onClick={onOverlayClose}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2">
              <button
                className={cn(
                  "rounded border px-2 py-1 text-xs",
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
                  "rounded border px-2 py-1 text-xs",
                  logsTab === "status"
                    ? "border-primary-600 bg-primary-600 text-white"
                    : "border-slate-300 bg-white text-slate-600",
                )}
                onClick={() => onLogsTabChange("status")}
              >
                {t("preview.diagnostics")}
              </button>
            </div>
            <div className="overflow-auto p-4">
              {logsTab === "events" ? (
                <ul className="space-y-2 text-xs text-slate-700">
                  {(events.length > 0
                    ? events
                        .slice(-160)
                        .reverse()
                        .map((event) =>
                          JSON.stringify(
                            {
                              createdAt: event.createdAt,
                              role: event.role,
                              kind: event.kind,
                              payload: event.payload,
                            },
                            null,
                            2,
                          ),
                        )
                    : [t("preview.none")]).map((line, index) => (
                    <li
                      key={`${line}-${index}`}
                      className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
                    >
                      <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-5 text-slate-700">
                        {line}
                      </pre>
                    </li>
                  ))}
                </ul>
              ) : (
                <ul className="space-y-2 text-xs text-slate-700">
                  {(compileDiagnostics.length > 0 ? compileDiagnostics : [t("preview.none")]).map((line, index) => (
                    <li
                      key={`${line}-${index}`}
                      className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
                    >
                      <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-5 text-slate-700">
                        {tryFormatJson(line) ?? line}
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
          onTest={onProtocolPing}
          onSubmit={onModelSubmit}
          t={t}
        />
      )}

      {deleteIntent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4">
          <div className="w-full max-w-md rounded-lg border border-slate-300 bg-white p-4 shadow-soft">
            <h3 className="text-sm font-semibold text-slate-800">{t("explorer.deleteConfirmTitle")}</h3>
            <p className="mt-2 text-xs text-slate-600">{deleteIntent.path}</p>
            <label className="mt-3 flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={deleteDontAskAgain}
                onChange={(event) => onDeleteDontAskChange(event.target.checked)}
              />
              {t("explorer.deleteDontAsk")}
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={onDeleteCancel}>
                {t("common.cancel")}
              </Button>
              <Button size="sm" onClick={onDeleteConfirm}>
                {t("common.confirm")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {integrityIssue && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4">
          <div className="w-full max-w-lg rounded-lg border border-slate-300 bg-white p-4 shadow-soft">
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
            "fixed bottom-4 right-4 z-40 rounded-md px-4 py-2 text-sm text-white shadow-soft",
            toast.type === "info" ? "bg-emerald-600" : "bg-rose-600",
          )}
        >
          {toast.message}
        </div>
      )}
    </>
  );
}
