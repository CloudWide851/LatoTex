import { Activity, CheckCircle2, Loader2, RefreshCw, Stethoscope, Wrench, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "../../../components/ui/button";
import { analysisEnvPrepareStart, analysisEnvPrepareStatus, analysisEnvStatus } from "../../../shared/api/analysis";
import { libraryCitationIndexRebuild, libraryCitationIndexStatus } from "../../../shared/api/library";
import { projectIntegrityRepair, projectIntegrityStatus, projectPrepareSearchIndex } from "../../../shared/api/projects";
import { runtimeLogInfo, runtimeLogListSessions, runtimeLogWrite, runtimeMemorySnapshot } from "../../../shared/api/runtime";
import type { AppSettings, PanelLayoutPrefs } from "../../../shared/types/app";
import { DEFAULT_PANEL_LAYOUT } from "../../app-config";
import { loadAnalysisTaskState } from "../../hooks/analysisTaskStore";
import {
  clearLatexWorkspaceSession,
  loadLatexWorkspaceSession,
} from "../workspace/latexWorkspaceSession";
import {
  bytesToMb,
  createInitialDoctorChecks,
  DOCTOR_CHECK_ORDER,
  formatDoctorMessage,
  isValidPanelLayout,
  repairTargetsForRepairId,
  SAFE_REPAIR_IDS,
  skillIdIsValid,
  sleep,
  statusTone,
  type DoctorCheck,
  type DoctorCheckId,
  type DoctorPhase,
  type DoctorRepairId,
  type DoctorStatus,
  type TranslationFn,
} from "./settingsDoctorHelpers";

export {
  createInitialDoctorChecks,
  formatDoctorMessage,
  repairTargetsForRepairId,
  SAFE_REPAIR_IDS,
} from "./settingsDoctorHelpers";

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

  const runDoctorCheck = async (id: DoctorCheckId): Promise<DoctorCheck> => {
    if (id === "runtimeLog") {
      const [info, sessions] = await Promise.all([runtimeLogInfo(), runtimeLogListSessions()]);
      return {
        id,
        titleKey: "settings.doctor.runtimeLog",
        status: info.sessionLogFile && sessions.sessions.length > 0 ? "pass" : "warn",
        phase: "done",
        messageKey: "settings.doctor.runtimeLog.ok",
        params: { file: info.sessionLogFile || "-", count: String(sessions.sessions.length) },
      };
    }
    if (id === "memory") {
      const memory = await runtimeMemorySnapshot();
      return {
        id,
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
    }
    if (id === "projectIntegrity" && activeProjectId) {
      const integrity = await projectIntegrityStatus(activeProjectId);
      const missing = integrity.missingRequired.length;
      return {
        id,
        titleKey: "settings.doctor.project",
        status: missing === 0 ? "pass" : "warn",
        phase: "done",
        messageKey: missing === 0 ? "settings.doctor.project.ok" : "settings.doctor.project.missing",
        params: missing === 0 ? undefined : { items: integrity.missingRequired.join(", ") },
        repairId: missing > 0 ? "projectIntegrity" : undefined,
      };
    }
    if (id === "searchIndex") {
      return {
        id,
        titleKey: "settings.doctor.searchIndex",
        status: "info",
        phase: "done",
        messageKey: "settings.doctor.searchIndex.info",
        repairId: "searchIndex",
      };
    }
    if (id === "latexSession" && activeProjectId) {
      const session = loadLatexWorkspaceSession(activeProjectId);
      const invalidPaths = (session?.tabPaths ?? []).filter((path) => !fileSet.has(path));
      return {
        id,
        titleKey: "settings.doctor.latexSession",
        status: invalidPaths.length === 0 ? "pass" : "warn",
        phase: "done",
        messageKey: invalidPaths.length === 0
          ? "settings.doctor.latexSession.ok"
          : "settings.doctor.latexSession.invalid",
        params: invalidPaths.length === 0 ? undefined : { count: String(invalidPaths.length) },
        repairId: invalidPaths.length > 0 ? "latexSession" : undefined,
      };
    }
    if (id === "pythonEnv" && activeProjectId) {
      const env = await analysisEnvStatus(activeProjectId);
      return {
        id,
        titleKey: "settings.doctor.pythonEnv",
        status: env.ready ? "pass" : "warn",
        phase: "done",
        messageKey: env.ready
          ? "settings.doctor.pythonEnv.ok"
          : "settings.doctor.pythonEnv.notReady",
        params: env.ready ? { python: env.pythonVersion ?? "-" } : { reason: env.lastError ?? "-" },
        repairId: env.ready ? undefined : "pythonEnv",
      };
    }
    if (id === "latexLayout") {
      const panelLayout = settings?.uiPrefs?.panelLayout as PanelLayoutPrefs | undefined;
      const latexLayoutOk = isValidPanelLayout(panelLayout?.latex, DEFAULT_PANEL_LAYOUT.latex!)
        && isValidPanelLayout(panelLayout?.latexTerminal, DEFAULT_PANEL_LAYOUT.latexTerminal!);
      return {
        id,
        titleKey: "settings.doctor.latexLayout",
        status: latexLayoutOk ? "pass" : "warn",
        phase: "done",
        messageKey: latexLayoutOk ? "settings.doctor.latexLayout.ok" : "settings.doctor.latexLayout.invalid",
        repairId: latexLayoutOk ? undefined : "latexLayout",
      };
    }
    if (id === "mcpConfig") {
      const servers = settings?.uiPrefs?.mcpServers ?? [];
      const enabled = settings?.uiPrefs?.agentToolPrefs?.mcpEnabled ?? true;
      const readyCount = servers.filter((server) =>
        server.enabled !== false && Boolean(server.id.trim()) && Boolean(server.command.trim())
      ).length;
      const draftCount = servers.length - readyCount;
      return {
        id,
        titleKey: "settings.doctor.mcpConfig",
        status: !enabled ? "info" : readyCount > 0 ? "pass" : draftCount > 0 ? "warn" : "info",
        phase: "done",
        messageKey: !enabled
          ? "settings.doctor.mcpConfig.disabled"
          : readyCount > 0
            ? "settings.doctor.mcpConfig.ok"
            : draftCount > 0
              ? "settings.doctor.mcpConfig.drafts"
              : "settings.doctor.mcpConfig.empty",
        params: { count: String(readyCount), drafts: String(draftCount) },
      };
    }
    if (id === "skillsConfig") {
      const skills = settings?.uiPrefs?.enabledSkills ?? [];
      const invalid = skills.filter((skill) => !skillIdIsValid(skill));
      return {
        id,
        titleKey: "settings.doctor.skillsConfig",
        status: invalid.length > 0 ? "warn" : skills.length > 0 ? "pass" : "info",
        phase: "done",
        messageKey: invalid.length > 0
          ? "settings.doctor.skillsConfig.invalid"
          : skills.length > 0
            ? "settings.doctor.skillsConfig.ok"
            : "settings.doctor.skillsConfig.empty",
        params: { count: String(skills.length), invalid: invalid.join(", ") },
      };
    }
    if (id === "analysisStore" && activeProjectId) {
      const state = await loadAnalysisTaskState(activeProjectId);
      const runs = state.tasks.flatMap((task) => task.runs);
      const eventRuns = runs.reduce((count, run) => count + (run.eventRunIds?.length ?? (run.agentRunId ? 1 : 0)), 0);
      return {
        id,
        titleKey: "settings.doctor.analysisStore",
        status: runs.length === 0 ? "info" : eventRuns > 0 ? "pass" : "warn",
        phase: "done",
        messageKey: runs.length === 0
          ? "settings.doctor.analysisStore.empty"
          : eventRuns > 0
            ? "settings.doctor.analysisStore.ok"
            : "settings.doctor.analysisStore.noEvents",
        params: { tasks: String(state.tasks.length), runs: String(runs.length), eventRuns: String(eventRuns) },
      };
    }
    if (id === "libraryCitationIndex" && activeProjectId) {
      const status = await libraryCitationIndexStatus(activeProjectId);
      const issueCount = status.duplicateKeys.length
        + status.invalidBibFiles.length
        + status.missingBibForPdfs.length
        + status.missingPdfForBibs.length;
      return {
        id,
        titleKey: "settings.doctor.libraryCitationIndex",
        status: issueCount === 0 ? "pass" : "warn",
        phase: "done",
        messageKey: issueCount === 0
          ? "settings.doctor.libraryCitationIndex.ok"
          : "settings.doctor.libraryCitationIndex.issues",
        params: {
          bibs: String(status.totalBibFiles),
          pdfs: String(status.totalPdfFiles),
          indexed: String(status.indexedEntries),
          duplicates: String(status.duplicateKeys.length),
          missingBib: String(status.missingBibForPdfs.length),
          missingPdf: String(status.missingPdfForBibs.length),
          invalid: String(status.invalidBibFiles.length),
        },
        repairId: issueCount > 0 ? "libraryCitationIndex" : undefined,
      };
    }
    if (id === "shareCollab") {
      const texCount = fileList.filter((path) => path.toLowerCase().endsWith(".tex")).length;
      return {
        id,
        titleKey: "settings.doctor.shareCollab",
        status: texCount > 0 ? "pass" : "warn",
        phase: "done",
        messageKey: texCount > 0 ? "settings.doctor.shareCollab.ok" : "settings.doctor.shareCollab.noTex",
        params: {
          count: String(texCount),
        },
      };
    }
    if (id === "runtimeAssets") {
      const info = await runtimeLogInfo();
      return {
        id,
        titleKey: "settings.doctor.runtimeAssets",
        status: "info",
        phase: "done",
        messageKey: "settings.doctor.runtimeAssets.ok",
        params: { mode: info.installMode || "-", version: info.version || "-" },
      };
    }
    return {
      id,
      titleKey: DOCTOR_CHECK_ORDER.find((item) => item.id === id)?.titleKey ?? "settings.doctor.title",
      status: "info",
      phase: "done",
      messageKey: "settings.doctor.skipped",
    };
  };

  const runChecks = async () => {
    setRunning(true);
    const initialChecks = createInitialDoctorChecks(activeProjectId);
    setChecks([]);
    await runtimeLogWrite("INFO", `doctor.check.start: items=${initialChecks.length}`).catch(() => undefined);
    const resultPromises = new Map(
      initialChecks.map((check) => [
        check.id,
        runDoctorCheck(check.id as DoctorCheckId).catch((error): DoctorCheck => ({
          ...check,
          status: check.id === "pythonEnv" || check.id === "memory" ? "warn" : "fail",
          phase: "done",
          messageKey: "settings.doctor.error",
          params: { reason: String(error) },
          repairId: check.id === "pythonEnv" ? "pythonEnv" : undefined,
        })),
      ]),
    );
    const finalChecks: DoctorCheck[] = [];
    try {
      for (const check of initialChecks) {
        const runningCheck: DoctorCheck = {
          ...check,
          phase: "running",
          messageKey: "settings.doctor.checkingItem",
        };
        upsertCheck(runningCheck);
        const result = await resultPromises.get(check.id)!;
        finalChecks.push(result);
        upsertCheck(result);
        await sleep(90);
      }
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
      } else if (repairId === "libraryCitationIndex" && activeProjectId) {
        await libraryCitationIndexRebuild(activeProjectId);
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
      const targetIds = repairTargetsForRepairId(repairId).filter((id) => {
        const projectScoped = ["projectIntegrity", "searchIndex", "latexSession", "pythonEnv", "analysisStore", "libraryCitationIndex", "shareCollab"];
        return activeProjectId || !projectScoped.includes(id);
      });
      for (const id of targetIds) {
        const titleKey = DOCTOR_CHECK_ORDER.find((item) => item.id === id)?.titleKey ?? "settings.doctor.title";
        upsertCheck({
          id,
          titleKey,
          status: "info",
          phase: "running",
          messageKey: "settings.doctor.rechecking",
        });
        if (repairId === "latexLayout" && id === "latexLayout") {
          upsertCheck({
            id,
            titleKey,
            status: "pass",
            phase: "done",
            messageKey: "settings.doctor.repairRechecked",
          });
          continue;
        }
        const result = await runDoctorCheck(id);
        upsertCheck({
          ...result,
          messageKey: result.status === "pass" ? "settings.doctor.repairRechecked" : result.messageKey,
        });
      }
      setLastRunAt(new Date().toISOString());
    } catch (error) {
      await runtimeLogWrite("ERROR", `doctor.repair.failed: ${repairId}, reason=${String(error)}`).catch(() => undefined);
      const targetIds = new Set(repairTargetsForRepairId(repairId));
      setChecks((prev) =>
        prev.map((item) =>
          item.repairId === repairId || targetIds.has(item.id as DoctorCheckId)
            ? {
                ...item,
                status: "fail",
                phase: "done",
                messageKey: "settings.doctor.repairFailed",
                params: { reason: String(error) },
              }
            : item,
        ),
      );
    } finally {
      setRepairing(null);
    }
  };

  const runSafeRepairs = async () => {
    const repairIds = Array.from(new Set(
      checks
        .map((check) => check.repairId)
        .filter((repairId): repairId is DoctorRepairId => {
          if (!repairId) {
            return false;
          }
          return SAFE_REPAIR_IDS.has(repairId);
        }),
    ));
    for (const repairId of repairIds) {
      await runRepair(repairId);
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
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => void runSafeRepairs()}
            disabled={running || Boolean(repairing) || !checks.some((check) => check.repairId && SAFE_REPAIR_IDS.has(check.repairId))}
          >
            <Wrench className="mr-2 h-4 w-4" />
            {repairing ? t("settings.doctor.repairing") : t("settings.doctor.repairSafe")}
          </Button>
          <Button onClick={() => void runChecks()} disabled={running || Boolean(repairing)}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {running ? t("settings.doctor.running") : t("settings.doctor.run")}
          </Button>
        </div>
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
              className={`motion-slide-up flex flex-wrap items-center gap-3 rounded-lg border px-3 py-3 transition-[border-color,background-color,color,transform,opacity] duration-200 ${statusTone(check.status)}`}
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
