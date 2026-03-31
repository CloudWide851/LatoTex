import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { resolveLocale } from "../../i18n";
import {
  analysisEnvPrepare,
  analysisEnvPrepareStart,
  analysisEnvPrepareStatus,
  analysisEnvStatus,
  pickAnalysisEnvDirectory,
} from "../../shared/api/analysis";
import { exitApplication, getHealthCheck, windowSyncIcon } from "../../shared/api/app";
import { listProjects } from "../../shared/api/projects";
import { waitForResourceWarmup } from "../../shared/api/resource-warmup";
import { runtimeLogInfo, runtimeLogWrite } from "../../shared/api/runtime";
import { getSettings } from "../../shared/api/settings";
import type { AnalysisEnvStatus, AppSettings, ProjectSummary, ResourceWarmupTaskStatus } from "../../shared/types/app";
import {
  applyTheme,
  DEFAULT_PANEL_LAYOUT,
  normalizeAgentBindings,
  type ThemeMode,
} from "../app-config";
import {
  createInitialAppStartupState,
  deriveComponentStartupState,
  type AppStartupPhase,
  type AppStartupState,
  type AppStartupStepKey,
  updateAppStartupSteps,
} from "./startupState";
import { shouldRunStartupForRetryToken } from "./startupRunGate";

type TranslationFn = (...args: any[]) => string;
type ToastSetter = (value: { type: "info" | "error"; message: string } | null) => void;
type SetLocale = (value: "en-US" | "zh-CN") => void;

type LoadProjectData = (
  projectId: string,
  options?: { includeGitRefresh?: boolean },
) => Promise<void>;

const ENV_PREPARE_POLL_MS = 320;
const ENV_PREPARE_POLL_LIMIT = 1600;

function describeWarmupStatus(status: ResourceWarmupTaskStatus, fallback: string): string {
  return String(status.message || status.currentItem || status.stage || fallback);
}

function normalizeWarmupProgress(percent: number): number {
  if (!Number.isFinite(percent)) {
    return 10;
  }
  return Math.max(10, Math.min(99, Math.round(percent)));
}
function normalizeSettings(appSettings: AppSettings): AppSettings {
  const backgroundList = Array.from(
    new Set(
      (appSettings.uiPrefs?.backgroundImagePaths ?? [])
        .map((item) => String(item ?? "").trim())
        .filter((item) => item.length > 0),
    ),
  );
  const legacyBackground = String(appSettings.uiPrefs?.backgroundImagePath ?? "").trim();
  if (legacyBackground && !backgroundList.includes(legacyBackground)) {
    backgroundList.unshift(legacyBackground);
  }
  const activeBackgroundPath = legacyBackground || backgroundList[0] || "";
  const rawBackgroundBlur = Number(appSettings.uiPrefs?.backgroundBlurPx ?? 18);
  const normalizedBackgroundBlur = Number.isFinite(rawBackgroundBlur)
    ? Math.max(4, Math.min(32, rawBackgroundBlur))
    : 18;
  return {
    ...appSettings,
    agentBindings: normalizeAgentBindings(appSettings.agentBindings ?? []),
    uiPrefs: {
      ...(appSettings.uiPrefs ?? {}),
      closeToTrayNoticeEnabled: appSettings.uiPrefs?.closeToTrayNoticeEnabled ?? true,
      closeBehavior: appSettings.uiPrefs?.closeBehavior ?? "ask",
      closeBehaviorRemember: appSettings.uiPrefs?.closeBehaviorRemember ?? false,
      theme: (appSettings.uiPrefs?.theme as ThemeMode | undefined) ?? "system",
      previewDefaultZoom: appSettings.uiPrefs?.previewDefaultZoom ?? 1,
      backgroundImagePath: activeBackgroundPath,
      backgroundImagePaths: backgroundList,
      backgroundBlurPx: normalizedBackgroundBlur,
      panelLayout: {
        ...DEFAULT_PANEL_LAYOUT,
        ...(appSettings.uiPrefs?.panelLayout ?? {}),
      },
    },
  };
}

function resolveInitialProjectId(
  projectList: ProjectSummary[],
  settings: AppSettings,
): string | null {
  const newWindowMode =
    typeof window !== "undefined"
    && new URLSearchParams(window.location.search).get("newWindow") === "1";
  if (newWindowMode) {
    return null;
  }
  const requested = String(settings.activeProjectId ?? "").trim();
  if (requested && projectList.some((item) => item.id === requested)) {
    return requested;
  }
  return projectList[0]?.id ?? null;
}

function buildAnalysisEnvSettings(
  settings: AppSettings,
  projectId: string,
  baseDir: string,
): AppSettings {
  const trimmedBaseDir = baseDir.trim();
  const nextRootsByProject = {
    ...(settings.uiPrefs?.analysisEnvRootsByProject ?? {}),
  };
  if (trimmedBaseDir) {
    nextRootsByProject[projectId] = trimmedBaseDir;
  }
  return {
    ...settings,
    uiPrefs: {
      ...(settings.uiPrefs ?? {}),
      analysisEnvRootsByProject: nextRootsByProject,
    },
  };
}

export function useAppStartup(params: {
  isTauriRuntime: boolean;
  loadProjectData: LoadProjectData;
  refreshGitWorkspace: (projectIdOverride?: string) => Promise<void>;
  persistSettings: (settings: AppSettings) => Promise<AppSettings>;
  settingsRef: MutableRefObject<AppSettings | null>;
  setStatus: (value: "ready" | "offline") => void;
  setProjects: (value: ProjectSummary[]) => void;
  setSettings: Dispatch<SetStateAction<AppSettings | null>>;
  setRuntimeInfo: (value: any) => void;
  setLocale: SetLocale;
  setActiveProjectId: (value: string | null) => void;
  setToast: ToastSetter;
  t: TranslationFn;
}) {
  const {
    isTauriRuntime,
    loadProjectData,
    refreshGitWorkspace,
    persistSettings,
    settingsRef,
    setStatus,
    setProjects,
    setSettings,
    setRuntimeInfo,
    setLocale,
    setActiveProjectId,
    setToast,
    t,
  } = params;
  const mountedRef = useRef(true);
  const attemptRef = useRef(0);
  const startedRetryTokenRef = useRef<number | null>(null);
  const startupProjectIdRef = useRef<string | null>(null);
  const currentStepKeyRef = useRef<AppStartupStepKey | null>(null);
  const [startupState, setStartupState] = useState<AppStartupState>(createInitialAppStartupState);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  const updateStep = useCallback((
    key: AppStartupStepKey,
    patch: { status?: "pending" | "running" | "ready" | "actionRequired" | "failed"; detail?: string | null; progress?: number | null },
    phase?: AppStartupPhase,
    extra?: Partial<Omit<AppStartupState, "steps" | "phase">>,
  ) => {
    setStartupState((prev) => {
      const nextCurrentStepKey = patch.status === "running" || patch.status === "actionRequired" ? key : prev.currentStepKey === key ? null : prev.currentStepKey;
      currentStepKeyRef.current = nextCurrentStepKey;
      return {
        ...prev,
        ...(typeof phase === "string" ? { phase } : null),
        ...(extra ?? {}),
        currentStepKey: nextCurrentStepKey,
        steps: updateAppStartupSteps(prev.steps, key, patch),
      };
    });
  }, []);

  const markStartupFailure = useCallback((key: AppStartupStepKey, error: unknown) => {
    const message = String(error || "startup.failed");
    updateStep(
      key,
      {
        status: "failed",
        detail: message,
        progress: null,
      },
      "failed",
      {
        error: message,
        blocking: true,
      },
    );
    setToast({ type: "error", message });
  }, [setToast, updateStep]);

  const finalizeReady = useCallback(async (projectId: string | null) => {
    setActiveProjectId(projectId);
    currentStepKeyRef.current = null;
    setStartupState((prev) => ({
      ...prev,
      phase: "ready",
      error: null,
      blocking: false,
      currentStepKey: null,
    }));
    await runtimeLogWrite(
      "INFO",
      `frontend startup ready, project=${projectId ?? "-"}`,
    ).catch(() => undefined);
  }, [setActiveProjectId]);

  const applyAnalysisEnvStatus = useCallback(async (projectId: string, status: AnalysisEnvStatus) => {
    if (status.ready) {
      updateStep(
        "analysisEnv",
        {
          status: "ready",
          detail: status.pythonVersion || status.venvPath || status.managedRoot || t("app.ready"),
          progress: 100,
        },
        "warming",
        {
          error: null,
          analysisEnvStatus: status,
          blocking: true,
        },
      );
      await finalizeReady(projectId);
      return true;
    }

    updateStep(
      "analysisEnv",
      {
        status: "actionRequired",
        detail: status.lastError || status.venvPath || status.managedRoot || t("analysis.envPromptProgress"),
        progress: null,
      },
      "actionRequired",
      {
        error: status.lastError || null,
        analysisEnvStatus: status,
        blocking: true,
      },
    );
    return false;
  }, [finalizeReady, t, updateStep]);

  const ensureAnalysisEnvReady = useCallback(async (projectId: string) => {
    updateStep(
      "analysisEnv",
      {
        status: "running",
        detail: t("analysis.envPromptProgress"),
        progress: 0,
      },
      "warming",
      {
        error: null,
        analysisEnvStatus: null,
        blocking: true,
      },
    );
    const status = await analysisEnvStatus(projectId);
    return applyAnalysisEnvStatus(projectId, status);
  }, [applyAnalysisEnvStatus, t, updateStep]);

  const pollAnalysisEnvPrepare = useCallback(async (taskId: string) => {
    for (let round = 0; round < ENV_PREPARE_POLL_LIMIT; round += 1) {
      const status = await analysisEnvPrepareStatus(taskId);
      if (!mountedRef.current) {
        return status;
      }
      updateStep(
        "analysisEnv",
        {
          status: status.status === "failed" ? "failed" : "running",
          detail: status.currentItem || status.message || status.stage || t("analysis.envPromptProgress"),
          progress: status.percent,
        },
        status.status === "failed" ? "failed" : "warming",
        {
          error: status.error || null,
          blocking: true,
        },
      );
      if (status.status === "completed") {
        return status;
      }
      if (status.status === "failed") {
        throw new Error(String(status.error || status.diagnostics?.[0] || "analysis env prepare failed"));
      }
      await new Promise((resolve) => window.setTimeout(resolve, ENV_PREPARE_POLL_MS));
    }
    throw new Error("analysis.env.prepare_timeout");
  }, [t, updateStep]);

  const runStartup = useCallback(async () => {
    attemptRef.current += 1;
    const attemptId = attemptRef.current;
    startupProjectIdRef.current = null;
    currentStepKeyRef.current = null;
    setStartupState(createInitialAppStartupState());
    setActiveProjectId(null);

    const isActiveAttempt = () => mountedRef.current && attemptRef.current === attemptId;
    const abortIfStale = () => {
      if (!isActiveAttempt()) {
        throw new Error("startup.stale_attempt");
      }
    };
    const markSkippedProjectSteps = (detail: string) => {
      setStartupState((prev) => ({
        ...prev,
        steps: prev.steps.map((step) => (
          step.key === "projectData" || step.key === "git" || step.key === "drawio" || step.key === "tectonic" || step.key === "analysisEnv"
            ? { ...step, status: "ready", detail, progress: 100 }
            : step
        )),
      }));
    };

    try {
      updateStep("health", { status: "running", detail: t("common.loading"), progress: 10 }, "warming", {
        error: null,
        blocking: true,
      });
      try {
        await getHealthCheck();
        abortIfStale();
        setStatus("ready");
        updateStep("health", { status: "ready", detail: t("app.ready"), progress: 100 }, "warming");
      } catch {
        abortIfStale();
        setStatus("offline");
        updateStep("health", { status: "ready", detail: t("app.offline"), progress: 100 }, "warming");
      }

      updateStep("settings", { status: "running", detail: t("common.loading"), progress: 10 }, "warming");
      if (isTauriRuntime) {
        await windowSyncIcon().catch(() => undefined);
      }
      const [projectList, appSettings, info] = await Promise.all([
        listProjects(),
        getSettings(),
        runtimeLogInfo(),
      ]);
      abortIfStale();
      setProjects(projectList);
      const normalizedSettings = normalizeSettings(appSettings);
      setSettings(normalizedSettings);
      setRuntimeInfo(info);
      const initialLocale = resolveLocale(
        appSettings.uiPrefs?.language ??
          (typeof window !== "undefined" ? window.localStorage.getItem("latotex.locale") : null),
      );
      setLocale(initialLocale);
      if (typeof window !== "undefined") {
        window.localStorage.setItem("latotex.locale", initialLocale);
      }
      applyTheme((normalizedSettings.uiPrefs?.theme as ThemeMode | undefined) ?? "system");
      await runtimeLogWrite(
        "INFO",
        `frontend initialization completed, installMode=${info.installMode}, version=${info.version}`,
      ).catch(() => undefined);
      updateStep("settings", { status: "ready", detail: info.version || t("app.ready"), progress: 100 }, "warming");

      updateStep("projects", { status: "running", detail: t("common.loading"), progress: 10 }, "warming");
      const targetProjectId = resolveInitialProjectId(projectList, normalizedSettings);
      startupProjectIdRef.current = targetProjectId;
      updateStep(
        "projects",
        {
          status: "ready",
          detail: targetProjectId
            ? (projectList.find((item) => item.id === targetProjectId)?.name ?? targetProjectId)
            : t("app.startup.noProject"),
          progress: 100,
        },
        "warming",
      );

      if (!targetProjectId) {
        markSkippedProjectSteps(t("app.startup.noProject"));
        await finalizeReady(null);
        return;
      }

      updateStep("projectData", { status: "running", detail: targetProjectId, progress: 10 }, "warming");
      await loadProjectData(targetProjectId, { includeGitRefresh: false });
      abortIfStale();
      updateStep("projectData", { status: "ready", detail: targetProjectId, progress: 100 }, "warming");

      updateStep("git", { status: "running", detail: targetProjectId, progress: 10 }, "warming");
      await refreshGitWorkspace(targetProjectId);
      abortIfStale();
      updateStep("git", { status: "ready", detail: targetProjectId, progress: 100 }, "warming");

      updateStep("drawio", { status: "running", detail: t("draw.warming"), progress: 10 }, "warming");
      const drawioWarmup = await waitForResourceWarmup({
        projectId: targetProjectId,
        scopes: ["drawio"],
        timeoutMs: 45_000,
        inactivityTimeoutMs: 15_000,
        onProgress: (status) => {
          abortIfStale();
          updateStep(
            "drawio",
            {
              status: "running",
              detail: describeWarmupStatus(status, t("draw.warming")),
              progress: normalizeWarmupProgress(status.percent),
            },
            "warming",
          );
        },
      });
      abortIfStale();
      updateStep(
        "drawio",
        { status: "ready", detail: t("app.ready"), progress: 100 },
        "warming",
        {
          drawioWarmupInfo: drawioWarmup.result?.drawio ?? null,
        },
      );

      updateStep("tectonic", { status: "running", detail: t("workspace.compileStage.warming_resources"), progress: 10 }, "warming");
      await waitForResourceWarmup({
        projectId: targetProjectId,
        scopes: ["tectonic"],
        timeoutMs: 600_000,
        inactivityTimeoutMs: 120_000,
        onProgress: (status) => {
          abortIfStale();
          updateStep(
            "tectonic",
            {
              status: "running",
              detail: describeWarmupStatus(status, t("workspace.compileStage.warming_resources")),
              progress: normalizeWarmupProgress(status.percent),
            },
            "warming",
          );
        },
      });
      abortIfStale();
      updateStep("tectonic", { status: "ready", detail: t("app.ready"), progress: 100 }, "warming");

      await ensureAnalysisEnvReady(targetProjectId);
    } catch (error) {
      if (!isActiveAttempt() || String(error) === "startup.stale_attempt") {
        return;
      }
      markStartupFailure(currentStepKeyRef.current ?? "settings", error);
    }
  }, [
    ensureAnalysisEnvReady,
    finalizeReady,
    isTauriRuntime,
    loadProjectData,
    markStartupFailure,
    refreshGitWorkspace,
    setActiveProjectId,
    setLocale,
    setProjects,
    setRuntimeInfo,
    setSettings,
    setStatus,
    t,
    updateStep,
  ]);

  useEffect(() => {
    if (!shouldRunStartupForRetryToken(startedRetryTokenRef.current, retryToken)) {
      return;
    }
    startedRetryTokenRef.current = retryToken;
    void runStartup();
  }, [retryToken, runStartup]);

  const handleStartupRetry = useCallback(() => {
    setRetryToken((prev) => prev + 1);
  }, []);

  const handleStartupChooseAnalysisEnvLocation = useCallback(async () => {
    const projectId = startupProjectIdRef.current;
    const settings = settingsRef.current;
    if (!projectId || !settings) {
      return;
    }
    try {
      const pickedDirectory = await pickAnalysisEnvDirectory();
      if (!pickedDirectory) {
        return;
      }
      const nextSettings = buildAnalysisEnvSettings(settings, projectId, pickedDirectory);
      await persistSettings(nextSettings);
      const status = await analysisEnvStatus(projectId);
      await applyAnalysisEnvStatus(projectId, status);
    } catch (error) {
      const message = String(error);
      setToast({ type: "error", message });
      updateStep(
        "analysisEnv",
        {
          status: "actionRequired",
          detail: message,
          progress: null,
        },
        "actionRequired",
        {
          error: message,
          blocking: true,
        },
      );
    }
  }, [applyAnalysisEnvStatus, persistSettings, setToast, settingsRef, updateStep]);

  const handleStartupPrepareAnalysisEnv = useCallback(async () => {
    const projectId = startupProjectIdRef.current;
    if (!projectId) {
      return;
    }
    try {
      updateStep(
        "analysisEnv",
        {
          status: "running",
          detail: t("analysis.envPromptProgress"),
          progress: 0,
        },
        "warming",
        {
          error: null,
          blocking: true,
        },
      );
      const started = await analysisEnvPrepareStart(projectId);
      const finalTaskStatus = await pollAnalysisEnvPrepare(started.taskId);
      const finalStatus = finalTaskStatus.result ?? await analysisEnvPrepare(projectId);
      await applyAnalysisEnvStatus(projectId, finalStatus);
      if (finalStatus.ready) {
        setToast({ type: "info", message: t("analysis.envPromptReady") });
      }
    } catch (error) {
      const message = String(error);
      setToast({ type: "error", message });
      updateStep(
        "analysisEnv",
        {
          status: "actionRequired",
          detail: message,
          progress: null,
        },
        "actionRequired",
        {
          error: message,
          blocking: true,
        },
      );
    }
  }, [applyAnalysisEnvStatus, pollAnalysisEnvPrepare, setToast, t, updateStep]);

  const componentStartupState = useMemo(
    () => deriveComponentStartupState(startupState.phase),
    [startupState.phase],
  );

  return {
    startupState,
    startupReady: startupState.phase === "ready",
    componentStartupState,
    handleStartupRetry,
    handleStartupExit: exitApplication,
    handleStartupChooseAnalysisEnvLocation,
    handleStartupPrepareAnalysisEnv,
  };
}
