import { useCallback } from "react";
import {
  getLibraryTree,
  importLibraryLink,
  importLibraryPdf,
  rescanLibrary,
  syncLibraryZotero,
} from "../../shared/api/library";
import {
  gitDownloadCancel,
  gitDownloadInstallerStart,
  gitRunInstaller,
} from "../../shared/api/git";
import type { GitDownloadStatus } from "../../shared/types/app";
import { runAppAction } from "./appActionRuntime";

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
  setSelectedLibraryPath: (value: string | null) => void;
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
    setSelectedLibraryPath,
    refreshGitWorkspace,
  } = params;

  const handleGitAction = useCallback(async (
    action: () => Promise<unknown>,
    actionLabel = "git.action",
  ) => {
    await runAppAction({
      action: async () => {
        await action();
        await refreshGitWorkspace();
      },
      fallbackValue: undefined,
      setBusy,
      setToast,
      successLogMessage: `${actionLabel}: success`,
      errorLogLabel: actionLabel,
    });
  }, [refreshGitWorkspace, setBusy, setToast]);

  const handleGitInstallerDownloadStart = useCallback(async () => {
    await runAppAction({
      action: async () => {
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
      },
      fallbackValue: undefined,
      setBusy,
      setToast,
      errorLogLabel: "git.installer.download_start",
    });
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
    await runAppAction({
      action: async () => {
        await gitDownloadCancel(gitDownloadTaskId);
        setSuppressAutoGitInstall(true);
      },
      fallbackValue: undefined,
      setToast,
      errorLogLabel: "git.installer.cancel",
    });
  }, [gitDownloadTaskId, setSuppressAutoGitInstall, setToast]);

  const handleGitRunInstaller = useCallback(async () => {
    if (!gitDownloadTaskId || gitInstallerLaunched) {
      return;
    }
    await runAppAction({
      action: async () => {
        await gitRunInstaller(gitDownloadTaskId);
        setGitInstallerLaunched(true);
      },
      fallbackValue: undefined,
      setToast,
      successMessage: t("git.installerStarted"),
      errorLogLabel: "git.installer.run",
    });
  }, [gitDownloadTaskId, gitInstallerLaunched, setGitInstallerLaunched, setToast, t]);

  const refreshLibraryTree = useCallback(async () => {
    if (!activeProjectId) {
      return;
    }
    const nextTree = await getLibraryTree(activeProjectId);
    setLibraryTree(nextTree);
  }, [activeProjectId, setLibraryTree]);

  const handleLibraryRescan = useCallback(async () => {
    if (!activeProjectId) {
      return;
    }
    await runAppAction({
      action: async () => {
        await rescanLibrary(activeProjectId);
        await refreshLibraryTree();
      },
      fallbackValue: undefined,
      setToast,
      errorLogLabel: "library.rescan",
    });
  }, [activeProjectId, refreshLibraryTree, setToast]);

  const handleLibraryImportPdf = useCallback(async () => {
    if (!activeProjectId) {
      return;
    }
    await runAppAction({
      action: async () => {
        const result = await importLibraryPdf(activeProjectId);
        if (!result) {
          return;
        }
        await refreshLibraryTree();
        setSelectedLibraryPath(result.relativePath || result.pdfRelativePath);
      },
      fallbackValue: undefined,
      setToast,
      successMessage: t("toast.fsUpdated"),
      errorLogLabel: "library.import_pdf",
    });
  }, [activeProjectId, refreshLibraryTree, setSelectedLibraryPath, setToast, t]);

  const handleLibraryImportLink = useCallback(async (link: string) => {
    if (!activeProjectId) {
      return;
    }
    const normalized = link.trim();
    if (!normalized) {
      return;
    }
    await runAppAction({
      action: async () => {
        const result = await importLibraryLink(activeProjectId, normalized);
        await refreshLibraryTree();
        setSelectedLibraryPath(result.relativePath);
      },
      fallbackValue: undefined,
      setToast,
      successMessage: t("toast.fsUpdated"),
      errorLogLabel: "library.import_link",
    });
  }, [activeProjectId, refreshLibraryTree, setSelectedLibraryPath, setToast, t]);

  const handleLibrarySyncZotero = useCallback(async (input: {
    ownerId: string;
    apiKey: string;
    scope?: "users" | "groups";
  }) => {
    if (!activeProjectId) {
      return;
    }
    const ownerId = input.ownerId.trim();
    const apiKey = input.apiKey.trim();
    if (!ownerId || !apiKey) {
      return;
    }
    await runAppAction({
      action: async () => {
        await syncLibraryZotero({
          projectId: activeProjectId,
          ownerId,
          apiKey,
          scope: input.scope ?? "users",
        });
        await refreshLibraryTree();
      },
      fallbackValue: undefined,
      setToast,
      successMessage: t("library.zoteroSyncDone"),
      errorLogLabel: "library.zotero_sync",
    });
  }, [activeProjectId, refreshLibraryTree, setToast, t]);

  return {
    handleGitAction,
    handleGitInstallerDownloadStart,
    handleGitInstallerCancel,
    handleGitRunInstaller,
    handleLibraryRescan,
    handleLibraryImportPdf,
    handleLibraryImportLink,
    handleLibrarySyncZotero,
  };
}
