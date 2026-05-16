import { ChevronDown, FileArchive, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Locale } from "../../../i18n";
import { cn } from "../../../lib/utils";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Select } from "../../../components/ui/select";
import { runtimeDiagnosticsBundleExport } from "../../../shared/api/runtime";
import {
  dropdownItemClassName,
  dropdownSearchInputClassName,
  dropdownSearchRowClassName,
  dropdownSurfaceClassName,
  dropdownTriggerClassName,
  useDropdownDismiss,
} from "../../../components/ui/dropdown";
import type { RuntimeLogEntry, RuntimeLogInfo, RuntimeLogSession } from "../../../shared/types/app";
import { normalizeLogLevel, resolveRuntimeLogTone } from "../logTone";

type TranslationFn = (key: any) => string;

function resolveConsoleMessage(entry: RuntimeLogEntry): string {
  const message = entry.message?.trim() || entry.raw?.trim();
  return message && message.length > 0 ? message : "-";
}

export function DiagnosticsSettingsSection(props: {
  runtimeInfo: RuntimeLogInfo | null;
  runtimeLogs: RuntimeLogEntry[];
  runtimeLogLoading: boolean;
  sessionLogName: string;
  runtimeLogSessions: RuntimeLogSession[];
  selectedLogFileName: string;
  locale: Locale;
  onReloadLogs: (options?: {
    silent?: boolean;
    logFileName?: string;
    refreshSessions?: boolean;
  }) => Promise<void>;
  onSelectLogFile: (fileName: string) => Promise<void>;
  onClearCurrentLog: () => Promise<void>;
  t: TranslationFn;
}) {
  const {
    runtimeInfo,
    runtimeLogs,
    runtimeLogLoading,
    sessionLogName,
    runtimeLogSessions,
    selectedLogFileName,
    onReloadLogs,
    onSelectLogFile,
    onClearCurrentLog,
    t,
  } = props;
  const [logLevelFilter, setLogLevelFilter] = useState("ALL");
  const [logKeyword, setLogKeyword] = useState("");
  const [clearLogConfirmOpen, setClearLogConfirmOpen] = useState(false);
  const [logFilePickerOpen, setLogFilePickerOpen] = useState(false);
  const [logFileQuery, setLogFileQuery] = useState("");
  const [bundleExporting, setBundleExporting] = useState(false);
  const [bundleStatus, setBundleStatus] = useState("");
  const consoleRef = useRef<HTMLDivElement | null>(null);
  const followTailRef = useRef(true);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  useDropdownDismiss({
    open: logFilePickerOpen,
    rootRef: pickerRef,
    onClose: () => {
      setLogFilePickerOpen(false);
      setLogFileQuery("");
    },
  });

  useEffect(() => {
    const targetLog = selectedLogFileName || (sessionLogName !== "-" ? sessionLogName : "");
    void onReloadLogs({
      logFileName: targetLog || undefined,
      refreshSessions: true,
    });
    const timer = window.setInterval(() => {
      const hidden = typeof document !== "undefined" && document.hidden;
      if (hidden) {
        return;
      }
      void onReloadLogs({
        silent: true,
        logFileName: targetLog || undefined,
      });
    }, 2800);
    return () => {
      window.clearInterval(timer);
    };
  }, [onReloadLogs, selectedLogFileName, sessionLogName]);

  useEffect(() => {
    if (!followTailRef.current) {
      return;
    }
    const node = consoleRef.current;
    if (!node) {
      return;
    }
    node.scrollTop = node.scrollHeight;
  }, [runtimeLogs.length]);

  const filteredRuntimeLogs = useMemo(() => {
    const keyword = logKeyword.trim().toLowerCase();
    return runtimeLogs.filter((entry) => {
      const level = entry.level.toUpperCase();
      if (logLevelFilter !== "ALL" && level !== logLevelFilter) {
        return false;
      }
      if (keyword) {
        const haystack = `${entry.message} ${entry.raw}`.toLowerCase();
        if (!haystack.includes(keyword)) {
          return false;
        }
      }
      return true;
    });
  }, [logKeyword, logLevelFilter, runtimeLogs]);

  const selectedLogName = selectedLogFileName || (sessionLogName !== "-" ? sessionLogName : "");
  const filteredSessions = useMemo(() => {
    const keyword = logFileQuery.trim().toLowerCase();
    if (!keyword) {
      return runtimeLogSessions;
    }
    return runtimeLogSessions.filter((item) => item.fileName.toLowerCase().includes(keyword));
  }, [logFileQuery, runtimeLogSessions]);
  const hasActiveFilter = Boolean(logLevelFilter !== "ALL" || logKeyword.trim());
  const exportDiagnosticsBundle = async () => {
    setBundleExporting(true);
    setBundleStatus("");
    try {
      const result = await runtimeDiagnosticsBundleExport();
      setBundleStatus(`${t("settings.diagnosticsBundleExported")}: ${result.fileName}`);
    } catch (error) {
      setBundleStatus(`${t("settings.diagnosticsBundleFailed")}: ${String(error)}`);
    } finally {
      setBundleExporting(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-gradient-to-r from-slate-50 to-slate-100 px-3 py-2 text-[11px] text-slate-600">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 overflow-hidden">
          <span className="truncate">
            {t("settings.currentLog")}: <span className="font-mono">{sessionLogName}</span>
          </span>
          <span className="truncate">
            {t("settings.installMode")}: {runtimeInfo?.installMode ?? "-"}
          </span>
          <span className="truncate">
            {t("settings.version")}: {runtimeInfo?.version ?? "-"}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={bundleExporting}
            onClick={() => {
              void exportDiagnosticsBundle();
            }}
            title={t("settings.diagnosticsBundlePrivacyHint")}
          >
            <FileArchive className="mr-1.5 h-3.5 w-3.5" />
            {bundleExporting ? t("settings.diagnosticsBundleExporting") : t("settings.diagnosticsBundleExport")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setClearLogConfirmOpen(true)}
          >
            {t("settings.logClearCurrent")}
          </Button>
        </div>
      </div>
      {bundleStatus ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {bundleStatus}
        </div>
      ) : null}

      <div className="rounded-lg border border-slate-200 bg-gradient-to-b from-white to-slate-50 p-2.5 shadow-[0_8px_20px_rgba(15,23,42,0.06)]">
        <div className="flex flex-wrap items-center gap-2">
          <div ref={pickerRef} className="relative w-full min-w-[230px] shrink-0 sm:w-[320px]">
            <button
              className={dropdownTriggerClassName("h-10 w-full justify-between px-3")}
              onClick={() => {
                setLogFilePickerOpen((prev) => !prev);
                if (!logFilePickerOpen) {
                  void onReloadLogs({
                    silent: true,
                    refreshSessions: true,
                    logFileName: selectedLogName || undefined,
                  });
                }
              }}
              title={selectedLogName || t("settings.logSelectPlaceholder")}
            >
              <span className="min-w-0 truncate font-mono text-xs">
                {selectedLogName || t("settings.logSelectPlaceholder")}
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 text-[color:var(--control-muted)] transition" />
            </button>

            {logFilePickerOpen ? (
              <div className={dropdownSurfaceClassName("absolute left-0 right-0 top-[calc(100%+6px)] z-[290] max-h-64 p-1") }>
                <div className={dropdownSearchRowClassName("sticky top-0 z-10 mb-1 py-1.5")}>
                  <Search className="h-3.5 w-3.5 text-slate-500" />
                  <input
                    value={logFileQuery}
                    onChange={(event) => setLogFileQuery(event.target.value)}
                    placeholder={t("settings.logSelectSearch")}
                    className={dropdownSearchInputClassName()}
                  />
                </div>

                {filteredSessions.length === 0 ? (
                  <div className="px-2 py-2 text-xs text-slate-500">{t("settings.logSelectEmpty")}</div>
                ) : (
                  <div className="space-y-0.5">
                    {filteredSessions.map((session) => {
                      const active = session.fileName === selectedLogName;
                      return (
                        <button
                          key={session.fileName}
                          className={dropdownItemClassName(active ? "control-menu-item--selected" : "")}
                          title={session.fileName}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            void onSelectLogFile(session.fileName);
                            setLogFilePickerOpen(false);
                            setLogFileQuery("");
                          }}
                        >
                          <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{session.fileName}</span>
                          <span className="shrink-0 text-[10px] text-slate-500">{session.modifiedAt}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : null}
          </div>

          <Select
            value={logLevelFilter}
            wrapperClassName="w-[190px] shrink-0"
            portalClassName="settings-scrollbar-hidden"
            className="text-sm"
            onChange={(event) => setLogLevelFilter(event.target.value)}
            aria-label={t("settings.logFilterLevel")}
          >
            <option value="ALL">{t("settings.logFilterAllLevels")}</option>
            <option value="INFO">{t("settings.logLevelInfo")}</option>
            <option value="WARN">{t("settings.logLevelWarn")}</option>
            <option value="ERROR">{t("settings.logLevelError")}</option>
            <option value="CRASH">{t("settings.logLevelCrash")}</option>
          </Select>

          <Input
            className="h-10 min-w-[180px] grow basis-[220px] text-sm"
            value={logKeyword}
            onChange={(event) => setLogKeyword(event.target.value)}
            placeholder={t("settings.logFilterKeyword")}
          />

          <Button
            size="sm"
            variant="secondary"
            className="h-11 px-5 text-sm font-semibold"
            disabled={!hasActiveFilter}
            onClick={() => {
              setLogLevelFilter("ALL");
              setLogKeyword("");
            }}
          >
            {t("settings.logFilterReset")}
          </Button>
        </div>
      </div>

      <div
        ref={consoleRef}
        className="settings-scrollbar-hidden h-full min-h-0 flex-1 overflow-auto rounded-lg border border-slate-800 bg-[#05080f] p-3"
        onScroll={(event) => {
          const node = event.currentTarget;
          const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
          followTailRef.current = distance <= 32;
        }}
      >
        {runtimeLogLoading && filteredRuntimeLogs.length === 0 ? (
          <div className="font-mono text-slate-300">{t("common.loading")}</div>
        ) : filteredRuntimeLogs.length === 0 ? (
          <div className="font-mono text-slate-500">{t("settings.logViewerEmpty")}</div>
        ) : (
          <div className="space-y-1 font-mono text-[length:var(--app-log-font-size)] leading-5">
            {filteredRuntimeLogs.map((entry, index) => {
              const tone = resolveRuntimeLogTone(entry);
              const label = normalizeLogLevel(entry.level, entry.message || entry.raw);
              return (
                <article
                  key={`${entry.timestamp}-${entry.level}-${index}`}
                  className={cn("rounded px-1.5 py-1", tone.rowClass)}
                >
                  <div className="flex items-start gap-2">
                    <span className={cn("shrink-0 font-semibold uppercase tracking-[0.1em]", tone.badgeClass)}>
                      [{label}]
                    </span>
                    <span className="shrink-0 text-slate-500">{entry.timestamp || "-"}</span>
                    <pre className={cn("min-w-0 flex-1 whitespace-pre-wrap break-all", tone.textClass)}>
                      {resolveConsoleMessage(entry)}
                    </pre>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {clearLogConfirmOpen && (
        <div className="fixed inset-0 z-[430] flex items-center justify-center bg-slate-900/55 p-4">
          <div className="w-full max-w-md rounded-lg border border-slate-300 bg-white p-4 shadow-soft">
            <h3 className="text-sm font-semibold text-slate-800">{t("settings.logClearModalTitle")}</h3>
            <p className="mt-2 text-xs text-slate-600">{t("settings.logClearModalDesc")}</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setClearLogConfirmOpen(false)}
              >
                {t("settings.logClearModalCancel")}
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  void onClearCurrentLog();
                  setClearLogConfirmOpen(false);
                }}
              >
                {t("settings.logClearModalConfirm")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


