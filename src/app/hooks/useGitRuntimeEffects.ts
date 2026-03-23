import { useEffect } from "react";
import { gitDownloadStatus } from "../../shared/api/git";

export function useGitRuntimeEffects(params: {
  page: string;
  activeProjectId: string | null;
  refreshGitWorkspace: (projectIdOverride?: string) => Promise<void>;
  gitDownloadTaskId: string | null;
  gitInstallerLaunched: boolean;
  handleGitRunInstaller: () => Promise<void>;
  setGitDownloadState: (value: any) => void;
  setGitDownloadTaskId: (value: string | null) => void;
  suspended?: boolean;
}) {
  const {
    page,
    activeProjectId,
    refreshGitWorkspace,
    gitDownloadTaskId,
    gitInstallerLaunched,
    handleGitRunInstaller,
    setGitDownloadState,
    setGitDownloadTaskId,
    suspended = false,
  } = params;

  useEffect(() => {
    if (suspended || page !== "git" || !activeProjectId) {
      return;
    }
    refreshGitWorkspace(activeProjectId).catch(() => undefined);
  }, [activeProjectId, page, refreshGitWorkspace, suspended]);

  useEffect(() => {
    if (suspended || !gitDownloadTaskId) {
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    let inFlight = false;
    const schedule = (ms: number) => {
      if (cancelled) {
        return;
      }
      timer = setTimeout(() => {
        void poll();
      }, ms);
    };

    const poll = async () => {
      if (cancelled || inFlight) {
        schedule(1100);
        return;
      }
      inFlight = true;
      try {
        const nextState = await gitDownloadStatus(gitDownloadTaskId);
        setGitDownloadState(nextState);
        if (nextState.status === "completed" && !gitInstallerLaunched) {
          handleGitRunInstaller().catch(() => undefined);
        }
        if (nextState.status === "failed" || nextState.status === "cancelled") {
          setGitDownloadTaskId(null);
          return;
        }
        if (nextState.status === "completed" && gitInstallerLaunched) {
          setGitDownloadTaskId(null);
          return;
        }
        const hidden = typeof document !== "undefined" && document.hidden;
        schedule(hidden ? 1800 : 900);
      } catch {
        schedule(1600);
      } finally {
        inFlight = false;
      }
    };

    schedule(600);
    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [
    gitDownloadTaskId,
    gitInstallerLaunched,
    handleGitRunInstaller,
    setGitDownloadState,
    setGitDownloadTaskId,
    suspended,
  ]);
}
