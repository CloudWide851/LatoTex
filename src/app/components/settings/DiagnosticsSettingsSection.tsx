import { Check, Copy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "../../../lib/utils";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import type { RuntimeLogEntry, RuntimeLogInfo } from "../../../shared/types/app";
import { Select } from "../../../components/ui/select";

type TranslationFn = (key: any) => string;

export function DiagnosticsSettingsSection(props: {
  runtimeInfo: RuntimeLogInfo | null;
  runtimeLogs: RuntimeLogEntry[];
  runtimeLogLoading: boolean;
  sessionLogName: string;
  onReloadLogs: (options?: { silent?: boolean }) => Promise<void>;
  onClearCurrentLog: () => Promise<void>;
  t: TranslationFn;
}) {
  const { runtimeInfo, runtimeLogs, runtimeLogLoading, sessionLogName, onReloadLogs, onClearCurrentLog, t } = props;
  const [logLevelFilter, setLogLevelFilter] = useState("ALL");
  const [logKeyword, setLogKeyword] = useState("");
  const [logFrom, setLogFrom] = useState("");
  const [logTo, setLogTo] = useState("");
  const [selectedLogKey, setSelectedLogKey] = useState<string | null>(null);
  const [clearLogConfirmOpen, setClearLogConfirmOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const buildEntryKey = (entry: RuntimeLogEntry, index: number) =>
    `${entry.timestamp}|${entry.level}|${entry.raw}|${index}`;

  useEffect(() => {
    void onReloadLogs();
    const timer = window.setInterval(() => {
      void onReloadLogs({ silent: true });
    }, 2500);
    return () => {
      window.clearInterval(timer);
    };
  }, [onReloadLogs]);

  const filteredRuntimeLogs = useMemo(() => {
    const from = logFrom.trim() ? logFrom.replace("T", " ") : "";
    const to = logTo.trim() ? logTo.replace("T", " ") : "";
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
      if (from && entry.timestamp && entry.timestamp < from) {
        return false;
      }
      if (to && entry.timestamp && entry.timestamp > to) {
        return false;
      }
      return true;
    });
  }, [logFrom, logKeyword, logLevelFilter, logTo, runtimeLogs]);

  const selectedLogEntry = useMemo(() => {
    if (!selectedLogKey) {
      return null;
    }
    return filteredRuntimeLogs.find((entry, index) => buildEntryKey(entry, index) === selectedLogKey) ?? null;
  }, [filteredRuntimeLogs, selectedLogKey]);

  const copyLogDetail = async () => {
    if (!selectedLogEntry) {
      return;
    }
    const text = selectedLogEntry.raw || selectedLogEntry.message;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs">
        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-500">{t("settings.currentLog")}</span>
          <span className="font-mono text-slate-700">{sessionLogName}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-500">{t("settings.installMode")}</span>
          <span className="text-slate-700">{runtimeInfo?.installMode ?? "-"}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-500">{t("settings.version")}</span>
          <span className="text-slate-700">{runtimeInfo?.version ?? "-"}</span>
        </div>
        <div className="pt-1">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setClearLogConfirmOpen(true)}
            >
              {t("settings.logClearCurrent")}
            </Button>
          </div>
        </div>
      </div>
      <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="text-xs text-slate-500">{t("settings.logDoubleClickHint")}</p>
        <div className="grid gap-2">
          <div className="grid grid-cols-[minmax(128px,180px)_minmax(160px,1fr)_minmax(188px,220px)_minmax(188px,220px)] gap-2 max-[1220px]:grid-cols-2 max-[780px]:grid-cols-1">
            <Select
              value={logLevelFilter}
              uiSize="sm"
              onChange={(event) => setLogLevelFilter(event.target.value)}
            >
              <option value="ALL">{t("settings.logFilterAllLevels")}</option>
              <option value="INFO">INFO</option>
              <option value="WARN">WARN</option>
              <option value="ERROR">ERROR</option>
              <option value="CRASH">CRASH</option>
            </Select>
            <Input
              className="h-8 text-xs"
              value={logKeyword}
              onChange={(event) => setLogKeyword(event.target.value)}
              placeholder={t("settings.logFilterKeyword")}
            />
            <Input
              className="h-8 text-xs"
              type="datetime-local"
              value={logFrom}
              onChange={(event) => setLogFrom(event.target.value)}
              title={t("settings.logFilterFrom")}
            />
            <Input
              className="h-8 text-xs"
              type="datetime-local"
              value={logTo}
              onChange={(event) => setLogTo(event.target.value)}
              title={t("settings.logFilterTo")}
            />
          </div>
        </div>
      </div>
      <div className="grid min-h-[280px] grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 max-[1100px]:grid-cols-1">
        {runtimeLogLoading ? (
          <div className="text-xs text-slate-500">{t("common.loading")}</div>
        ) : filteredRuntimeLogs.length === 0 ? (
          <div className="text-xs text-slate-500">{t("settings.logViewerEmpty")}</div>
        ) : (
          <>
            <div className="max-h-[50vh] space-y-2 overflow-auto pr-1">
              {filteredRuntimeLogs.map((entry, index) => {
                const upper = entry.level.toUpperCase();
                const lowerMessage = entry.message.toLowerCase();
                const toneClass =
                  upper.includes("ERROR") || upper.includes("CRASH")
                    ? "border-rose-300 bg-rose-50 text-rose-700"
                    : upper.includes("WARN")
                      ? "border-amber-300 bg-amber-50 text-amber-700"
                      : lowerMessage.includes("success") ||
                          lowerMessage.includes("completed") ||
                          lowerMessage.includes("ok=true")
                        ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                        : "border-slate-300 bg-white text-slate-700";
                const entryKey = buildEntryKey(entry, index);
                return (
                  <div
                    key={entryKey}
                    className={`rounded border px-3 py-2 ${toneClass} ${selectedLogKey === entryKey ? "ring-2 ring-primary-300" : ""}`}
                    onDoubleClick={() => setSelectedLogKey(entryKey)}
                  >
                    <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                      <span className="font-semibold">
                        {t("settings.logLevel")}: {entry.level}
                      </span>
                      <span>
                        {t("settings.logTime")}: {entry.timestamp || "-"}
                      </span>
                    </div>
                    <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-5">
                      {entry.message || entry.raw}
                    </pre>
                  </div>
                );
              })}
            </div>
            <div className="min-h-0 rounded-md border border-slate-300 bg-white p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h4 className="text-xs font-semibold text-slate-700">{t("settings.logDetailTitle")}</h4>
                <button
                  className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                  onClick={() => {
                    void copyLogDetail();
                  }}
                  disabled={!selectedLogEntry}
                  title={t("settings.logCopy")}
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>{copied ? t("settings.logCopied") : t("settings.logCopy")}</span>
                </button>
              </div>
              {selectedLogEntry ? (
                <pre className="max-h-[46vh] overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-5 text-slate-700">
                  {selectedLogEntry.raw || selectedLogEntry.message}
                </pre>
              ) : (
                <div className="text-xs text-slate-500">{t("settings.logDoubleClickHint")}</div>
              )}
            </div>
          </>
        )}
      </div>
      {clearLogConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4">
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
                  setSelectedLogKey(null);
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
