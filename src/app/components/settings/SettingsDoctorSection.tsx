import { Activity, CheckCircle2, Loader2, RefreshCw, Stethoscope, Wrench, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "../../../components/ui/button";
import { analysisEnvPrepareStart, analysisEnvPrepareStatus, analysisEnvStatus } from "../../../shared/api/analysis";
import { projectIntegrityRepair, projectIntegrityStatus, projectPrepareSearchIndex } from "../../../shared/api/projects";
import { runtimeLogInfo, runtimeLogListSessions, runtimeLogWrite, runtimeMemorySnapshot } from "../../../shared/api/runtime";
import type { AppSettings, PanelLayoutPrefs } from "../../../shared/types/app";
import { DEFAULT_PANEL_LAYOUT } from "../../app-config";
import {
  clearLatexWorkspaceSession,
  loadLatexWorkspaceSession,
} from "../workspace/latexWorkspaceSession";

type TranslationFn = (key: any) => string;
type DoctorStatus = "pass" | "warn" | "fail" | "info";
type DoctorPhase = "pending" | "running" | "done";
type DoctorRepairId =
  | "projectIntegrity"
  | "searchIndex"
  | "latexSession"
  | "latexLayout"
  | "pythonEnv"
  | "releaseMemory";

type DoctorCheck = {
  id: string;
  titleKey: string;
  status: DoctorStatus;
  phase: DoctorPhase;
  messageKey: string;
  params?: Record<string, string>;
  repairId?: DoctorRepairId;
};

type DoctorCheckId =
  | "runtimeLog"
  | "memory"
  | "projectIntegrity"
  | "searchIndex"
  | "latexSession"
  | "pythonEnv"
  | "latexLayout";

const DOCTOR_CHECK_ORDER: Array<{ id: DoctorCheckId; titleKey: string }> = [
  { id: "runtimeLog", titleKey: "settings.doctor.runtimeLog" },
  { id: "memory", titleKey: "settings.doctor.memory" },
  { id: "projectIntegrity", titleKey: "settings.doctor.project" },
  { id: "searchIndex", titleKey: "settings.doctor.searchIndex" },
  { id: "latexSession", titleKey: "settings.doctor.latexSession" },
  { id: "pythonEnv", titleKey: "settings.doctor.pythonEnv" },
  { id: "latexLayout", titleKey: "settings.doctor.latexLayout" },
];

export function formatDoctorMessage(
  t: TranslationFn,
  key: string,
  params?: Record<string, string>,
): string {
  let message = t(key);
  for (const [name, value] of Object.entries(params ?? {})) {
    message = message.replaceAll(`{${name}}`, value);
  }
  return message;
}

export function createInitialDoctorChecks(activeProjectId: string | null): DoctorCheck[] {
  return DOCTOR_CHECK_ORDER
    .filter((item) => activeProjectId || !["projectIntegrity", "searchIndex", "latexSession", "pythonEnv"].includes(item.id))
    .map((item) => ({
      id: item.id,
      titleKey: item.titleKey,
      status: "info",
      phase: "pending",
      messageKey: "settings.doctor.pending",
    }));
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function bytesToMb(value: number | null | undefined): string {
  if (!value || value <= 0) {
    return "-";
  }
  return `${Math.round(value / 1024 / 1024)} MB`;
}

function isValidPanelLayout(layout: unknown, fallback: number[]): boolean {
  if (!Array.isArray(layout) || layout.length !== fallback.length) {
    return false;
  }
  const sum = layout.reduce((acc, value) => acc + Number(value), 0);
  return Number.isFinite(sum)
    && sum > 0
    && layout.every((value) => Number.isFinite(Number(value)) && Number(value) >= 5);
}

function statusTone(status: DoctorStatus) {
  if (status === "pass") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "warn") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  if (status === "fail") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function StatusIcon(props: { status: DoctorStatus; phase?: DoctorPhase }) {
  if (props.phase === "running") {
    return <Loader2 className="h-4 w-4 animate-spin text-[color:var(--app-accent)]" />;
  }
  if (props.status === "pass") {
    return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  }
  if (props.status === "fail") {
    return <XCircle className="h-4 w-4 text-rose-600" />;
  }
  if (props.status === "warn") {
    return <Wrench className="h-4 w-4 text-amber-600" />;
  }
  return <Activity className="h-4 w-4 text-slate-500" />;
}

export function SettingsDoctorSection(props: {
  activeProjectId: string | null;
  fileList: string[];
  locale: string;
  settings: AppSettings | null;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings | null>>;
  onReleaseMemory?: () => void;
  t: TranslationFn;
}) {
  const { activeProjectId, fileList, locale, settings, setSettings, onReleaseMemory, t } = props;
  const [checks, setChecks] = useState<DoctorCheck[]>([]);
  const [running, setRunning] = useState(false);
  const [repairing, setRepairing] = useState<DoctorRepairId | null>(null);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const fileSet = useMemo(() => new Set(fileList), [fileList]);

  const upsertCheck = (check: DoctorCheck) => {
    setChecks((prev) => {
      const existingIndex = prev.findIndex((item) => item.id === check.id);
      if (existingIndex < 0) {
        return [...prev, check];
      }
      const next = [...prev];
      next[existingIndex] = check;
      return next;
    });
  };

  const markRunning = (id: DoctorCheckId) => {
    setChecks((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, phase: "running", messageKey: "settings.doctor.checkingItem" }
          : item,
      ),
    );
  };

  const runChecks = async () => {
    setRunning(true);
    const initialChecks = createInitialDoctorChecks(activeProjectId);
    const nextById = new Map<string, DoctorCheck>(initialChecks.map((check) => [check.id, check]));
    setChecks(initialChecks);
    await runtimeLogWrite("INFO", "doctor.check.start").catch(() => undefined);
    try {
      markRunning("runtimeLog");
      try {
        const [info, sessions] = await Promise.all([runtimeLogInfo(), runtimeLogListSessions()]);
        const check: DoctorCheck = {
          id: "runtimeLog",
          titleKey: "settings.doctor.runtimeLog",
          status: info.sessionLogFile && sessions.sessions.length > 0 ? "pass" : "warn",
          phase: "done",
          messageKey: "settings.doctor.runtimeLog.ok",
          params: {
            file: info.sessionLogFile || "-",
            count: String(sessions.sessions.length),
          },
        };
        nextById.set(check.id, check);
        upsertCheck(check);
      } catch (error) {
        const check: DoctorCheck = {
          id: "runtimeLog",
          titleKey: "settings.doctor.runtimeLog",
          status: "fail",
          phase: "done",
          messageKey: "settings.doctor.error",
          params: { reason: String(error) },
        };
        nextById.set(check.id, check);
        upsertCheck(check);
      }

      markRunning("memory");
      try {
        const memory = await runtimeMemorySnapshot();
        const check: DoctorCheck = {
          id: "memory",
          titleKey: "settings.doctor.memory",
          status: "info",
          phase: "done",
          messageKey: "settings.doctor.memory.ok",
          params: {
            rss: bytesToMb(memory.totalRssBytes ?? memory.rssBytes),
            webview: bytesToMb(memory.webviewRssBytes),
          },
          repairId: onReleaseMemory ? "releaseMemory" : undefined,
        };
        nextById.set(check.id, check);
        upsertCheck(check);
      } catch (error) {
        const check: DoctorCheck = {
          id: "memory",
          titleKey: "settings.doctor.memory",
          status: "warn",
          phase: "done",
          messageKey: "settings.doctor.error",
          params: { reason: String(error) },
        };
        nextById.set(check.id, check);
        upsertCheck(check);
      }

      if (!activeProjectId) {
        const check: DoctorCheck = {
          id: "projectIntegrity",
          titleKey: "settings.doctor.project",
          status: "info",
          phase: "done",
          messageKey: "settings.doctor.noProject",
        };
        nextById.set(check.id, check);
        upsertCheck(check);
      } else {
        markRunning("projectIntegrity");
        try {
          const integrity = await projectIntegrityStatus(activeProjectId);
          const missing = integrity.missingRequired.length;
          const check: DoctorCheck = {
            id: "projectIntegrity",
            titleKey: "settings.doctor.project",
            status: missing === 0 ? "pass" : "warn",
            phase: "done",
            messageKey: missing === 0 ? "settings.doctor.project.ok" : "settings.doctor.project.missing",
            params: missing === 0 ? undefined : { items: integrity.missingRequired.join(", ") },
            repairId: missing > 0 ? "projectIntegrity" : undefined,
          };
          nextById.set(check.id, check);
          upsertCheck(check);
        } catch (error) {
          const check: DoctorCheck = {
            id: "projectIntegrity",
            titleKey: "settings.doctor.project",
            status: "fail",
            phase: "done",
            messageKey: "settings.doctor.error",
            params: { reason: String(error) },
          };
          nextById.set(check.id, check);
          upsertCheck(check);
        }

        markRunning("searchIndex");
        const searchCheck: DoctorCheck = {
          id: "searchIndex",
          titleKey: "settings.doctor.searchIndex",
          status: "info",
          phase: "done",
          messageKey: "settings.doctor.searchIndex.info",
          repairId: "searchIndex",
        };
        nextById.set(searchCheck.id, searchCheck);
        upsertCheck(searchCheck);

        markRunning("latexSession");
        const session = loadLatexWorkspaceSession(activeProjectId);
        const invalidPaths = (session?.tabPaths ?? []).filter((path) => !fileSet.has(path));
        const sessionCheck: DoctorCheck = {
          id: "latexSession",
          titleKey: "settings.doctor.latexSession",
          status: invalidPaths.length === 0 ? "pass" : "warn",
          phase: "done",
          messageKey: invalidPaths.length === 0
            ? "settings.doctor.latexSession.ok"
            : "settings.doctor.latexSession.invalid",
          params: invalidPaths.length === 0 ? undefined : { count: String(invalidPaths.length) },
          repairId: invalidPaths.length > 0 ? "latexSession" : undefined,
        };
        nextById.set(sessionCheck.id, sessionCheck);
        upsertCheck(sessionCheck);

        markRunning("pythonEnv");
        try {
          const env = await analysisEnvStatus(activeProjectId);
          const check: DoctorCheck = {
            id: "pythonEnv",
            titleKey: "settings.doctor.pythonEnv",
            status: env.ready ? "pass" : "warn",
            phase: "done",
            messageKey: env.ready
              ? "settings.doctor.pythonEnv.ok"
              : "settings.doctor.pythonEnv.notReady",
            params: env.ready
              ? { python: env.pythonVersion ?? "-" }
              : { reason: env.lastError ?? "-" },
            repairId: env.ready ? undefined : "pythonEnv",
          };
          nextById.set(check.id, check);
          upsertCheck(check);
        } catch (error) {
          const check: DoctorCheck = {
            id: "pythonEnv",
            titleKey: "settings.doctor.pythonEnv",
            status: "warn",
            phase: "done",
            messageKey: "settings.doctor.error",
            params: { reason: String(error) },
            repairId: "pythonEnv",
          };
          nextById.set(check.id, check);
          upsertCheck(check);
        }
      }

      markRunning("latexLayout");
      const panelLayout = settings?.uiPrefs?.panelLayout as PanelLayoutPrefs | undefined;
      const latexLayoutOk = isValidPanelLayout(panelLayout?.latex, DEFAULT_PANEL_LAYOUT.latex!)
        && isValidPanelLayout(panelLayout?.latexTerminal, DEFAULT_PANEL_LAYOUT.latexTerminal!);
      const layoutCheck: DoctorCheck = {
        id: "latexLayout",
        titleKey: "settings.doctor.latexLayout",
        status: latexLayoutOk ? "pass" : "warn",
        phase: "done",
        messageKey: latexLayoutOk ? "settings.doctor.latexLayout.ok" : "settings.doctor.latexLayout.invalid",
        repairId: latexLayoutOk ? undefined : "latexLayout",
      };
      nextById.set(layoutCheck.id, layoutCheck);
      upsertCheck(layoutCheck);

      const finalChecks = initialChecks
        .map((check) => nextById.get(check.id) ?? check)
        .map((check) => check.phase === "pending"
          ? { ...check, phase: "done" as const, messageKey: "settings.doctor.skipped" }
          : check);
      setChecks(finalChecks);
      setLastRunAt(new Date().toISOString());
      await runtimeLogWrite("INFO", `doctor.check.done: items=${finalChecks.length}`).catch(() => undefined);
    } finally {
      setRunning(false);
    }
  };

  const runRepair = async (repairId: DoctorRepairId) => {
    if (!activeProjectId && repairId !== "latexLayout" && repairId !== "releaseMemory") {
      return;
    }
    setRepairing(repairId);
    await runtimeLogWrite("INFO", `doctor.repair.start: ${repairId}`).catch(() => undefined);
    try {
      if (repairId === "projectIntegrity" && activeProjectId) {
        await projectIntegrityRepair(activeProjectId);
      } else if (repairId === "searchIndex" && activeProjectId) {
        await projectPrepareSearchIndex(activeProjectId);
      } else if (repairId === "latexSession" && activeProjectId) {
        clearLatexWorkspaceSession(activeProjectId);
      } else if (repairId === "latexLayout") {
        setSettings((prev) => {
          if (!prev) {
            return prev;
          }
          return {
            ...prev,
            uiPrefs: {
              ...(prev.uiPrefs ?? {}),
              panelLayout: {
                ...(prev.uiPrefs?.panelLayout ?? DEFAULT_PANEL_LAYOUT),
                latex: [...(DEFAULT_PANEL_LAYOUT.latex ?? [22, 48, 30])],
                latexTerminal: [...(DEFAULT_PANEL_LAYOUT.latexTerminal ?? [78, 22])],
              },
            },
          };
        });
      } else if (repairId === "pythonEnv" && activeProjectId) {
        const started = await analysisEnvPrepareStart(activeProjectId);
        let completed = false;
        for (let index = 0; index < 240; index += 1) {
          const status = await analysisEnvPrepareStatus(started.taskId);
          if (status.status === "completed") {
            completed = true;
            break;
          }
          if (status.status === "failed") {
            throw new Error(status.error || status.diagnostics?.[0] || "analysis.env.prepare_failed");
          }
          await sleep(1000);
        }
        if (!completed) {
          throw new Error("analysis.env.prepare_timeout");
        }
      } else if (repairId === "releaseMemory") {
        onReleaseMemory?.();
      }
      await runtimeLogWrite("INFO", `doctor.repair.done: ${repairId}`).catch(() => undefined);
      await runChecks();
    } catch (error) {
      await runtimeLogWrite("ERROR", `doctor.repair.failed: ${repairId}, reason=${String(error)}`).catch(() => undefined);
      setChecks((prev) =>
        prev.map((item) =>
          item.repairId === repairId
            ? {
                ...item,
                status: "fail",
                phase: "done",
                messageKey: "settings.doctor.error",
                params: { reason: String(error) },
              }
            : item,
        ),
      );
    } finally {
      setRepairing(null);
    }
  };

  const lastRunLabel = lastRunAt
    ? new Intl.DateTimeFormat(locale, {
        dateStyle: "short",
        timeStyle: "medium",
      }).format(new Date(lastRunAt))
    : null;

  return (
    <div className="settings-scrollbar-hidden h-full min-h-0 overflow-auto rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Stethoscope className="h-4 w-4" />
            <span>{t("settings.doctor.title")}</span>
          </div>
          <p className="mt-1 text-xs text-slate-600">{t("settings.doctor.hint")}</p>
          {lastRunLabel ? (
            <p className="mt-1 text-[11px] text-slate-500">
              {formatDoctorMessage(t, "settings.doctor.lastRun", { time: lastRunLabel })}
            </p>
          ) : null}
        </div>
        <Button onClick={() => void runChecks()} disabled={running || Boolean(repairing)}>
          <RefreshCw className="mr-2 h-4 w-4" />
          {running ? t("settings.doctor.running") : t("settings.doctor.run")}
        </Button>
      </div>

      <div className="mt-3 space-y-2">
        {checks.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-8 text-center text-sm text-slate-500">
            {t("settings.doctor.empty")}
          </div>
        ) : (
          checks.map((check) => (
            <article
              key={check.id}
              className={`flex flex-wrap items-center gap-3 rounded-lg border px-3 py-3 ${statusTone(check.status)}`}
            >
              <StatusIcon status={check.status} phase={check.phase} />
              <div className="min-w-[220px] flex-1">
                <h3 className="text-sm font-semibold">{t(check.titleKey)}</h3>
                <p className="mt-1 break-words text-xs">{formatDoctorMessage(t, check.messageKey, check.params)}</p>
              </div>
              {check.repairId && check.phase === "done" ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={running || Boolean(repairing)}
                  onClick={() => void runRepair(check.repairId!)}
                >
                  {repairing === check.repairId ? t("settings.doctor.repairing") : t("settings.doctor.repair")}
                </Button>
              ) : null}
            </article>
          ))
        )}
      </div>
    </div>
  );
}
