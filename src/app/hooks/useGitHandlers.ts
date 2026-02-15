import { useCallback } from "react";
import {
  getLibraryTree,
  gitDownloadCancel,
  gitDownloadInstallerStart,
  gitRunInstaller,
  rescanLibrary,
} from "../../shared/api/desktop";
import type { GitDownloadStatus } from "../../shared/types/app";

type ToastSetter = (value: { type: "info" | "error"; message: string } | null) => void;

type TranslationFn = (key: any) => string;

export function useGitHandlers(params: {
  t: TranslationFn;
  activeProjectId: string | null;
  gitDownloadTaskId: string | null;
  gitInstallerLaunched: boolean;
  setBusy: (value: boolean) => void;
  setToast: ToastSetter;
  setGitDownloadState: (value: GitDownloadStatus | null) => void;
  setGitDownloadTaskId: (value: string | null) => void;
  setGitInstallerLaunched: (value: boolean) => void;
  setSuppressAutoGitInstall: (value: boolean) => void;
  setLibraryTree: (value: any) => void;
  refreshGitWorkspace: (projectIdOverride?: string) => Promise<void>;
}) {
  const {
    t,
    activeProjectId,
    gitDownloadTaskId,
    gitInstallerLaunched,
    setBusy,
    setToast,
    setGitDownloadState,
    setGitDownloadTaskId,
    setGitInstallerLaunched,
    setSuppressAutoGitInstall,
    setLibraryTree,
    refreshGitWorkspace,
  } = params;

  const handleGitAction = useCallback(async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      await refreshGitWorkspace();
    } catch (error) {
      setToast({ type: "error", message: String(error) });
    } finally {
      setBusy(false);
    }
  }, [refreshGitWorkspace, setBusy, setToast]);

  const handleGitInstallerDownloadStart = useCallback(async () => {
    setBusy(true);
    try {
      const started = await gitDownloadInstallerStart();
      setSuppressAutoGitInstall(false);
      setGitInstallerLaunched(false);
      setGitDownloadTaskId(started.taskId);
      setGitDownloadState({
        taskId: started.taskId,
        status: "downloading",
        fileName: started.fileName,
        downloadedBytes: 0,
        totalBytes: 0,
        speedBps: 0,
        progressPercent: 0,
        installerPath: "",
      });
    } catch (error) {
      setToast({ type: "error", message: String(error) });
    } finally {
      setBusy(false);
    }
  }, [
    setBusy,
    setGitDownloadState,
    setGitDownloadTaskId,
    setGitInstallerLaunched,
    setSuppressAutoGitInstall,
    setToast,
  ]);

  const handleGitInstallerCancel = useCallback(async () => {
    if (!gitDownloadTaskId) {
      return;
    }
    try {
      await gitDownloadCancel(gitDownloadTaskId);
      setSuppressAutoGitInstall(true);
    } catch (error) {
      setToast({ type: "error", message: String(error) });
    }
  }, [gitDownloadTaskId, setSuppressAutoGitInstall, setToast]);

  const handleGitRunInstaller = useCallback(async () => {
    if (!gitDownloadTaskId || gitInstallerLaunched) {
      return;
    }
    try {
      await gitRunInstaller(gitDownloadTaskId);
      setGitInstallerLaunched(true);
      setToast({ type: "info", message: t("git.installerStarted") });
    } catch (error) {
      setToast({ type: "error", message: String(error) });
    }
  }, [gitDownloadTaskId, gitInstallerLaunched, setGitInstallerLaunched, setToast, t]);

  const handleLibraryRescan = useCallback(async () => {
    if (!activeProjectId) {
      return;
    }
    setBusy(true);
    try {
      await rescanLibrary(activeProjectId);
      const nextTree = await getLibraryTree(activeProjectId);
      setLibraryTree(nextTree);
    } catch (error) {
      setToast({ type: "error", message: String(error) });
    } finally {
      setBusy(false);
    }
  }, [activeProjectId, setBusy, setLibraryTree, setToast]);

  return {
    handleGitAction,
    handleGitInstallerDownloadStart,
    handleGitInstallerCancel,
    handleGitRunInstaller,
    handleLibraryRescan,
  };
}
