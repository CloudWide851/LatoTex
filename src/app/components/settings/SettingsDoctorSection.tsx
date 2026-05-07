import { Activity, CheckCircle2, RefreshCw, Stethoscope, Wrench, XCircle } from "lucide-react";
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
  message: string;
  repairId?: DoctorRepairId;
};

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

function StatusIcon(props: { status: DoctorStatus }) {
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
  settings: AppSettings | null;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings | null>>;
  onReleaseMemory?: () => void;
  t: TranslationFn;
}) {
  const { activeProjectId, fileList, settings, setSettings, onReleaseMemory, t } = props;
  const [checks, setChecks] = useState<DoctorCheck[]>([]);
  const [running, setRunning] = useState(false);
  const [repairing, setRepairing] = useState<DoctorRepairId | null>(null);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const fileSet = useMemo(() => new Set(fileList), [fileList]);

  const runChecks = async () => {
    setRunning(true);
    const next: DoctorCheck[] = [];
    await runtimeLogWrite("INFO", "doctor.check.start").catch(() => undefined);
    try {
      try {
        const [info, sessions] = await Promise.all([runtimeLogInfo(), runtimeLogListSessions()]);
        next.push({
          id: "runtimeLog",
          titleKey: "settings.doctor.runtimeLog",
          status: info.sessionLogFile && sessions.sessions.length > 0 ? "pass" : "warn",
          message: t("settings.doctor.runtimeLog.ok")
            .replace("{file}", info.sessionLogFile || "-")
            .replace("{count}", String(sessions.sessions.length)),
        });
      } catch (error) {
        next.push({
          id: "runtimeLog",
          titleKey: "settings.doctor.runtimeLog",
          status: "fail",
          message: String(error),
        });
      }

      try {
        const memory = await runtimeMemorySnapshot();
        next.push({
          id: "memory",
          titleKey: "settings.doctor.memory",
          status: "info",
          message: t("settings.doctor.memory.ok")
            .replace("{rss}", bytesToMb(memory.totalRssBytes ?? memory.rssBytes))
            .replace("{webview}", bytesToMb(memory.webviewRssBytes)),
          repairId: onReleaseMemory ? "releaseMemory" : undefined,
        });
      } catch (error) {
        next.push({
          id: "memory",
          titleKey: "settings.doctor.memory",
          status: "warn",
          message: String(error),
        });
      }

      if (!activeProjectId) {
        next.push({
          id: "project",
          titleKey: "settings.doctor.project",
          status: "info",
          message: t("settings.doctor.noProject"),
        });
      } else {
        try {
          const integrity = await projectIntegrityStatus(activeProjectId);
          next.push({
            id: "projectIntegrity",
            titleKey: "settings.doctor.project",
            status: integrity.missingRequired.length === 0 ? "pass" : "warn",
            message: integrity.missingRequired.length === 0
              ? t("settings.doctor.project.ok")
              : t("settings.doctor.project.missing").replace("{items}", integrity.missingRequired.join(", ")),
            repairId: integrity.missingRequired.length > 0 ? "projectIntegrity" : undefined,
          });
        } catch (error) {
          next.push({
            id: "projectIntegrity",
            titleKey: "settings.doctor.project",
            status: "fail",
            message: String(error),
          });
        }

        next.push({
          id: "searchIndex",
          titleKey: "settings.doctor.searchIndex",
          status: "info",
          message: t("settings.doctor.searchIndex.info"),
          repairId: "searchIndex",
        });

        const session = loadLatexWorkspaceSession(activeProjectId);
        const invalidPaths = (session?.tabPaths ?? []).filter((path) => !fileSet.has(path));
        next.push({
          id: "latexSession",
          titleKey: "settings.doctor.latexSession",
          status: invalidPaths.length === 0 ? "pass" : "warn",
          message: invalidPaths.length === 0
            ? t("settings.doctor.latexSession.ok")
            : t("settings.doctor.latexSession.invalid").replace("{count}", String(invalidPaths.length)),
          repairId: invalidPaths.length > 0 ? "latexSession" : undefined,
        });

        try {
          const env = await analysisEnvStatus(activeProjectId);
          next.push({
            id: "pythonEnv",
            titleKey: "settings.doctor.pythonEnv",
            status: env.ready ? "pass" : "warn",
            message: env.ready
              ? t("settings.doctor.pythonEnv.ok").replace("{python}", env.pythonVersion ?? "-")
              : t("settings.doctor.pythonEnv.notReady").replace("{reason}", env.lastError ?? "-"),
            repairId: env.ready ? undefined : "pythonEnv",
          });
        } catch (error) {
          next.push({
            id: "pythonEnv",
            titleKey: "settings.doctor.pythonEnv",
            status: "warn",
            message: String(error),
            repairId: "pythonEnv",
          });
        }
      }

      const panelLayout = settings?.uiPrefs?.panelLayout as PanelLayoutPrefs | undefined;
      const latexLayoutOk = isValidPanelLayout(panelLayout?.latex, DEFAULT_PANEL_LAYOUT.latex!)
        && isValidPanelLayout(panelLayout?.latexTerminal, DEFAULT_PANEL_LAYOUT.latexTerminal!);
      next.push({
        id: "latexLayout",
        titleKey: "settings.doctor.latexLayout",
        status: latexLayoutOk ? "pass" : "warn",
        message: latexLayoutOk ? t("settings.doctor.latexLayout.ok") : t("settings.doctor.latexLayout.invalid"),
        repairId: latexLayoutOk ? undefined : "latexLayout",
      });

      setChecks(next);
      setLastRunAt(new Date().toLocaleString());
      await runtimeLogWrite("INFO", `doctor.check.done: items=${next.length}`).catch(() => undefined);
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
          item.repairId === repairId ? { ...item, status: "fail", message: String(error) } : item,
        ),
      );
    } finally {
      setRepairing(null);
    }
  };

  return (
    <div className="library-scrollbar h-full min-h-0 overflow-auto rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Stethoscope className="h-4 w-4" />
            <span>{t("settings.doctor.title")}</span>
          </div>
          <p className="mt-1 text-xs text-slate-600">{t("settings.doctor.hint")}</p>
          {lastRunAt ? <p className="mt-1 text-[11px] text-slate-500">{t("settings.doctor.lastRun").replace("{time}", lastRunAt)}</p> : null}
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
              <StatusIcon status={check.status} />
              <div className="min-w-[220px] flex-1">
                <h3 className="text-sm font-semibold">{t(check.titleKey)}</h3>
                <p className="mt-1 break-words text-xs">{check.message}</p>
              </div>
              {check.repairId ? (
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
