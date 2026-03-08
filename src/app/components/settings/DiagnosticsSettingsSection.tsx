import { useEffect, useMemo, useRef, useState } from "react";
import type { Locale } from "../../../i18n";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Select } from "../../../components/ui/select";
import type { RuntimeLogEntry, RuntimeLogInfo } from "../../../shared/types/app";

type TranslationFn = (key: any) => string;

function resolveLineTone(entry: RuntimeLogEntry): string {
  const upper = entry.level.toUpperCase();
  const lowerMessage = entry.message.toLowerCase();
  if (upper.includes("ERROR") || upper.includes("CRASH")) {
    return "text-rose-300";
  }
  if (upper.includes("WARN")) {
    return "text-amber-300";
  }
  if (
    lowerMessage.includes("success") ||
    lowerMessage.includes("completed") ||
    lowerMessage.includes("ok=true")
  ) {
    return "text-emerald-300";
  }
  return "text-slate-200";
}

function renderConsoleLine(entry: RuntimeLogEntry): string {
  const timestamp = entry.timestamp?.trim() || "-";
  const level = entry.level?.trim().toUpperCase() || "INFO";
  const message = entry.message?.trim() || entry.raw?.trim() || "-";
  return `[${timestamp}] [${level}] ${message}`;
}

function normalizeLogDateInput(value: string): string {
  const text = value.trim();
  if (!text) {
    return "";
  }
  const normalized = text
    .replace(/[./]/g, "-")
    .replace("T", " ")
    .replace(/\s+/g, " ");
  const match = normalized.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/,
  );
  if (!match) {
    return "";
  }
  const [, yy, mm, dd, hh = "0", mi = "0", ss = "0"] = match;
  const clamp = (input: string, min: number, max: number) => {
    const n = Number(input);
    if (!Number.isFinite(n)) {
      return min;
    }
    return Math.min(max, Math.max(min, Math.floor(n)));
  };
  const year = clamp(yy, 1970, 9999);
  const month = clamp(mm, 1, 12);
  const day = clamp(dd, 1, 31);
  const hour = clamp(hh, 0, 23);
  const minute = clamp(mi, 0, 59);
  const second = clamp(ss, 0, 59);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
}

export function DiagnosticsSettingsSection(props: {
  runtimeInfo: RuntimeLogInfo | null;
  runtimeLogs: RuntimeLogEntry[];
  runtimeLogLoading: boolean;
  sessionLogName: string;
  locale: Locale;
  onReloadLogs: (options?: { silent?: boolean }) => Promise<void>;
  onClearCurrentLog: () => Promise<void>;
  t: TranslationFn;
}) {
  const { runtimeInfo, runtimeLogs, runtimeLogLoading, sessionLogName, locale, onReloadLogs, onClearCurrentLog, t } = props;
  const [logLevelFilter, setLogLevelFilter] = useState("ALL");
  const [logKeyword, setLogKeyword] = useState("");
  const [logFrom, setLogFrom] = useState("");
  const [logTo, setLogTo] = useState("");
  const [logFilterOpen, setLogFilterOpen] = useState(false);
  const [clearLogConfirmOpen, setClearLogConfirmOpen] = useState(false);
  const consoleRef = useRef<HTMLDivElement | null>(null);
  const followTailRef = useRef(true);

  useEffect(() => {
    void onReloadLogs();
    const timer = window.setInterval(() => {
      const hidden = typeof document !== "undefined" && document.hidden;
      if (hidden) {
        return;
      }
      void onReloadLogs({ silent: true });
    }, 2800);
    return () => {
      window.clearInterval(timer);
    };
  }, [onReloadLogs]);

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
    const from = normalizeLogDateInput(logFrom);
    const to = normalizeLogDateInput(logTo);
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
  const datePlaceholder = locale === "zh-CN" ? "YYYY/MM/DD HH:mm:ss" : "YYYY-MM-DD HH:mm:ss";
  const hasActiveFilter = Boolean(
    logLevelFilter !== "ALL" || logKeyword.trim() || normalizeLogDateInput(logFrom) || normalizeLogDateInput(logTo),
  );

  return (
    <div className="grid h-full min-h-0 gap-2 rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
        <div className="flex min-w-0 items-center gap-3 overflow-hidden">
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
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setClearLogConfirmOpen(true)}
        >
          {t("settings.logClearCurrent")}
        </Button>
      </div>

      <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setLogFilterOpen((prev) => !prev)}
          >
            {logFilterOpen ? t("settings.logFilterHide") : t("settings.logFilterOpen")}
          </Button>
          <div className="flex flex-wrap items-center gap-1 text-[11px] text-slate-600">
            {hasActiveFilter ? (
              <>
                {logLevelFilter !== "ALL" ? (
                  <span className="rounded border border-slate-300 bg-white px-1.5 py-0.5">{logLevelFilter}</span>
                ) : null}
                {logKeyword.trim() ? (
                  <span className="rounded border border-slate-300 bg-white px-1.5 py-0.5">{logKeyword.trim()}</span>
                ) : null}
                {normalizeLogDateInput(logFrom) ? (
                  <span className="rounded border border-slate-300 bg-white px-1.5 py-0.5">{normalizeLogDateInput(logFrom)}</span>
                ) : null}
                {normalizeLogDateInput(logTo) ? (
                  <span className="rounded border border-slate-300 bg-white px-1.5 py-0.5">{normalizeLogDateInput(logTo)}</span>
                ) : null}
              </>
            ) : (
              <span>{t("settings.logFilterAllLevels")}</span>
            )}
          </div>
        </div>

        {logFilterOpen ? (
          <div className="mt-2 grid grid-cols-[minmax(128px,168px)_minmax(180px,1fr)_minmax(188px,220px)_minmax(188px,220px)] gap-2 max-[1260px]:grid-cols-2 max-[780px]:grid-cols-1">
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
              type="text"
              value={logFrom}
              onChange={(event) => setLogFrom(event.target.value)}
              placeholder={datePlaceholder}
              title={t("settings.logFilterFrom")}
            />
            <Input
              className="h-8 text-xs"
              type="text"
              value={logTo}
              onChange={(event) => setLogTo(event.target.value)}
              placeholder={datePlaceholder}
              title={t("settings.logFilterTo")}
            />
          </div>
        ) : null}
      </div>

      <div
        ref={consoleRef}
        className="hide-scrollbar h-[min(34vh,320px)] min-h-[220px] flex-1 overflow-auto rounded-md border border-slate-300 bg-slate-950 p-3 font-mono text-[11px] leading-5"
        onScroll={(event) => {
          const node = event.currentTarget;
          const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
          followTailRef.current = distance <= 32;
        }}
      >
        {runtimeLogLoading && filteredRuntimeLogs.length === 0 ? (
          <div className="text-slate-300">{t("common.loading")}</div>
        ) : filteredRuntimeLogs.length === 0 ? (
          <div className="text-slate-400">{t("settings.logViewerEmpty")}</div>
        ) : (
          <div className="space-y-1">
            {filteredRuntimeLogs.map((entry, index) => (
              <pre
                key={`${entry.timestamp}-${entry.level}-${index}`}
                className={`whitespace-pre-wrap break-all ${resolveLineTone(entry)}`}
              >
                {renderConsoleLine(entry)}
              </pre>
            ))}
          </div>
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
