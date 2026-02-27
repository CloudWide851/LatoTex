import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useCallback, useEffect } from "react";
import { getModelApiKey, getSettings, projectIntegrityRepair, projectIntegrityStatus, runtimeLogWrite, saveModelApiKeyVerified, testModel, windowSyncIcon } from "../../shared/api/desktop";
import { isPdfPath } from "../../shared/utils/fileKind";
import type { CloseTabsAction, ModelCatalogItem } from "../../shared/types/app";
import {
  resolveCredentialSaveErrorMessage,
  resolveReadbackFailureMessage,
  verifyModelApiKeyReadback,
} from "./modelApiKeySave";
import { getTabIdsByAction } from "./useEditorTabs";
import { generateGitSummary } from "./useGitSummaryGenerator";
import { useWorkspaceShortcuts } from "./useWorkspaceShortcuts";

export function useAppContainerWorkspaceActions(params: any) {
  const {
    selectedFile,
    editorContent,
    markPathSaved,
    handleSaveFile,
    handleWindowControl,
    requestUnsavedGuard,
    editorTabsRef,
    closeGuardUnlockedRef,
    handleInitProjectFromFolder,
    resetEditorSession,
    handleEditorUndo,
    handleEditorRedo,
    handleCompile,
    handleExportCompiledPdf,
    isTauriRuntime,
    collectDirtyPaths,
    setEditorTabs,
    previewTabIdRef,
    setPreviewTabId,
    closeTabsNow,
    dirtyByPathRef,
    fileSet,
    activeTabIdRef,
    setActiveTabId,
    buildEditorTab,
    setSelectedFile,
    activeProjectIdRef,
    integrityCheckedRef,
    integrityIssue,
    setIntegrityIssue,
    setToast,
    setActiveProjectId,
    loadProjectData,
    setBusy,
    t,
    lastLoadedProjectIdRef,
    activeProjectId,
    settings,
    setModelTestById,
    setModelTestActiveId,
    setModelTestBusy,
    persistSettings,
    cancelPendingAutoSave,
    setSettings,
    setDraftModelApiKeys,
  } = params;

  const handleSaveActiveFile = useCallback(async () => {
    const ok = await handleSaveFile();
    if (ok && selectedFile && !isPdfPath(selectedFile)) {
      markPathSaved(selectedFile, editorContent);
    }
    return ok;
  }, [editorContent, handleSaveFile, markPathSaved, selectedFile]);

  const handleWindowControlWithGuard = useCallback((action: "minimize" | "toggle" | "close") => {
    if (action !== "close") {
      void handleWindowControl(action);
      return;
    }
    requestUnsavedGuard(
      "closeWindow",
      editorTabsRef.current.map((tab: any) => tab.path),
      async () => {
        closeGuardUnlockedRef.current = true;
        await handleWindowControl("close");
        window.setTimeout(() => {
          closeGuardUnlockedRef.current = false;
        }, 400);
      },
    );
  }, [handleWindowControl, requestUnsavedGuard, editorTabsRef, closeGuardUnlockedRef]);

  const handleInitProjectFromFolderWithGuard = useCallback(() => {
    requestUnsavedGuard(
      "switchProject",
      editorTabsRef.current.map((tab: any) => tab.path),
      async () => {
        resetEditorSession();
        await handleInitProjectFromFolder();
      },
    );
  }, [handleInitProjectFromFolder, requestUnsavedGuard, resetEditorSession, editorTabsRef]);

  const handleOpenNewWindow = useCallback(() => {
    if (!isTauriRuntime) {
      return;
    }
    try {
      const label = `latotex-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const created = new WebviewWindow(label, {
        title: t("app.brand"),
        url: "/?newWindow=1",
        width: 1200,
        height: 760,
        resizable: true,
        decorations: false,
      });
      created.once("tauri://created", () => {
        void windowSyncIcon().catch(() => undefined);
        void runtimeLogWrite("INFO", `new window created: ${label}`).catch(() => undefined);
      });
      created.once("tauri://error", (error: unknown) => {
        const reason = typeof error === "string" ? error : JSON.stringify(error);
        setToast({ type: "error", message: t("toast.windowActionFailed") });
        void runtimeLogWrite("ERROR", `new window create failed: ${reason}`).catch(() => undefined);
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setToast({ type: "error", message: t("toast.windowActionFailed") });
      void runtimeLogWrite("ERROR", `new window create failed: ${reason}`).catch(() => undefined);
    }
  }, [isTauriRuntime, setToast, t]);

  useWorkspaceShortcuts({
    handleEditorUndo,
    handleEditorRedo,
    handleSaveFile: () => {
      void handleSaveActiveFile();
    },
    handleCompile,
    handleExportCompiledPdf,
    handleOpenNewWindow,
  });

  useEffect(() => {
    if (!isTauriRuntime) {
      return;
    }
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .onCloseRequested((event) => {
        if (closeGuardUnlockedRef.current) {
          return;
        }
        const candidatePaths = editorTabsRef.current.map((tab: any) => tab.path);
        const dirtyPaths = collectDirtyPaths(candidatePaths);
        event.preventDefault();
        if (dirtyPaths.length === 0) {
          void handleWindowControl("close");
          return;
        }
        requestUnsavedGuard("closeWindow", candidatePaths, async () => {
          closeGuardUnlockedRef.current = true;
          await handleWindowControl("close");
        });
      })
      .then((off) => {
        unlisten = off;
      })
      .catch(() => undefined);
    return () => {
      unlisten?.();
    };
  }, [collectDirtyPaths, handleWindowControl, isTauriRuntime, requestUnsavedGuard, editorTabsRef, closeGuardUnlockedRef]);

  const activateTabById = useCallback((tabId: string) => {
    const target = editorTabsRef.current.find((tab: any) => tab.id === tabId);
    if (!target) {
      return;
    }
    setEditorTabs((prev: any[]) =>
      prev.map((tab) => (tab.id === tabId ? { ...tab, lastAccessed: Date.now() } : tab)),
    );
    setActiveTabId(tabId);
    setSelectedFile(target.path);
  }, [editorTabsRef, setActiveTabId, setEditorTabs, setSelectedFile]);

  const handleTabSelect = useCallback((tabId: string) => {
    activateTabById(tabId);
  }, [activateTabById]);

  const openWorkspaceFile = useCallback((path: string, mode: "preview" | "pinned" = "preview") => {
    if (!path || !fileSet.has(path)) {
      return;
    }
    const tabs = editorTabsRef.current;
    const existing = tabs.find((tab: any) => tab.path === path);
    if (existing) {
      if (mode === "pinned" && (!existing.pinned || existing.preview)) {
        setEditorTabs((prev: any[]) =>
          prev.map((tab) =>
            tab.id === existing.id
              ? { ...tab, pinned: true, preview: false, lastAccessed: Date.now() }
              : tab,
          ),
        );
        if (previewTabIdRef.current === existing.id) {
          setPreviewTabId(null);
        }
      }
      activateTabById(existing.id);
      return;
    }

    const openTab = () => {
      let nextTabs = editorTabsRef.current;
      if (mode === "preview") {
        const currentPreviewId = previewTabIdRef.current;
        const currentPreview = currentPreviewId
          ? nextTabs.find((tab: any) => tab.id === currentPreviewId)
          : null;
        if (currentPreview && !currentPreview.pinned && currentPreview.path !== path) {
          nextTabs = nextTabs.filter((tab: any) => tab.id !== currentPreview.id);
        }
      }
      const newTab = buildEditorTab(path, mode === "pinned", mode === "preview");
      setEditorTabs([...nextTabs, newTab]);
      setActiveTabId(newTab.id);
      setSelectedFile(path);
      setPreviewTabId(mode === "preview" ? newTab.id : previewTabIdRef.current);
    };

    if (mode === "preview") {
      const currentPreviewId = previewTabIdRef.current;
      const currentPreview = currentPreviewId
        ? tabs.find((tab: any) => tab.id === currentPreviewId)
        : null;
      if (currentPreview && !currentPreview.pinned && currentPreview.path !== path) {
        requestUnsavedGuard("switchFile", [currentPreview.path], openTab);
        return;
      }
    }
    openTab();
  }, [activateTabById, buildEditorTab, editorTabsRef, fileSet, previewTabIdRef, requestUnsavedGuard, setActiveTabId, setEditorTabs, setPreviewTabId, setSelectedFile]);

  const handleTabPin = useCallback((tabId: string) => {
    setEditorTabs((prev: any[]) =>
      prev.map((tab) =>
        tab.id === tabId
          ? { ...tab, pinned: true, preview: false, lastAccessed: Date.now() }
          : tab,
      ),
    );
    if (previewTabIdRef.current === tabId) {
      setPreviewTabId(null);
    }
  }, [previewTabIdRef, setEditorTabs, setPreviewTabId]);

  const handleTabClose = useCallback((tabId: string) => {
    const tab = editorTabsRef.current.find((item: any) => item.id === tabId);
    if (!tab) {
      return;
    }
    requestUnsavedGuard("closeTabs", [tab.path], () => closeTabsNow([tabId]));
  }, [closeTabsNow, requestUnsavedGuard, editorTabsRef]);

  const handleTabCloseAction = useCallback((action: CloseTabsAction, referenceTabId: string) => {
    const tabIds = getTabIdsByAction(
      editorTabsRef.current,
      referenceTabId,
      action,
      dirtyByPathRef.current,
    );
    if (tabIds.length === 0) {
      return;
    }
    const candidatePaths = editorTabsRef.current
      .filter((tab: any) => tabIds.includes(tab.id))
      .map((tab: any) => tab.path);
    requestUnsavedGuard("closeTabs", candidatePaths, () => closeTabsNow(tabIds));
  }, [closeTabsNow, requestUnsavedGuard, editorTabsRef, dirtyByPathRef]);

  const handleSelectWorkspacePath = useCallback((path: string | null) => {
    if (!path) {
      return;
    }
    openWorkspaceFile(path, "pinned");
  }, [openWorkspaceFile]);

  useEffect(() => {
    if (!selectedFile || !fileSet.has(selectedFile)) {
      return;
    }
    const existing = editorTabsRef.current.find((tab: any) => tab.path === selectedFile);
    if (existing) {
      if (activeTabIdRef.current !== existing.id) {
        setActiveTabId(existing.id);
      }
      return;
    }
    const tab = buildEditorTab(selectedFile, true, false);
    setEditorTabs((prev: any[]) => [...prev, tab]);
    setActiveTabId(tab.id);
  }, [fileSet, selectedFile, editorTabsRef, activeTabIdRef, setActiveTabId, buildEditorTab, setEditorTabs]);

  const handleProjectChange = useCallback((projectId: string | null) => {
    const proceed = async () => {
      if (!projectId) {
        setIntegrityIssue(null);
        resetEditorSession();
        setActiveProjectId(null);
        return;
      }
      if (projectId === activeProjectIdRef.current) {
        return;
      }
      if (!integrityCheckedRef.current.has(projectId)) {
        try {
          const integrity = await projectIntegrityStatus(projectId);
          if (integrity.missingRequired.length > 0) {
            setIntegrityIssue({
              projectId,
              missingRequired: integrity.missingRequired,
            });
            return;
          }
          integrityCheckedRef.current.add(projectId);
        } catch (error) {
          setToast({ type: "error", message: String(error) });
          return;
        }
      }
      setIntegrityIssue(null);
      resetEditorSession();
      setActiveProjectId(projectId);
    };

    if (projectId === activeProjectIdRef.current) {
      return;
    }
    requestUnsavedGuard(
      "switchProject",
      editorTabsRef.current.map((tab: any) => tab.path),
      proceed,
    );
  }, [requestUnsavedGuard, resetEditorSession, setToast, activeProjectIdRef, integrityCheckedRef, setIntegrityIssue, setActiveProjectId, editorTabsRef]);

  const handleIntegrityRepair = useCallback(async () => {
    if (!integrityIssue) {
      return;
    }
    setBusy(true);
    try {
      const result = await projectIntegrityRepair(integrityIssue.projectId);
      if (result.missingRequired.length > 0) {
        setToast({ type: "error", message: t("toast.integrityRepairFailed") });
        return;
      }
      integrityCheckedRef.current.add(integrityIssue.projectId);
      setIntegrityIssue(null);
      if (activeProjectIdRef.current === integrityIssue.projectId) {
        await loadProjectData(integrityIssue.projectId);
      } else {
        setActiveProjectId(integrityIssue.projectId);
      }
      setToast({ type: "info", message: t("toast.integrityRepaired") });
    } catch (error) {
      setToast({ type: "error", message: String(error) });
    } finally {
      setBusy(false);
    }
  }, [integrityIssue, loadProjectData, t, setBusy, setToast, setIntegrityIssue, activeProjectIdRef, setActiveProjectId, integrityCheckedRef]);

  const handleIntegrityCancel = useCallback(() => {
    const fallback = lastLoadedProjectIdRef.current;
    setIntegrityIssue(null);
    if (!fallback) {
      setActiveProjectId(null);
      return;
    }
    if (activeProjectIdRef.current !== fallback) {
      setActiveProjectId(fallback);
    }
  }, [lastLoadedProjectIdRef, setIntegrityIssue, setActiveProjectId, activeProjectIdRef]);

  const handleTestModel = useCallback(async (modelId: string) => {
    setModelTestBusy(true);
    setModelTestActiveId(modelId);
    try {
      const result = await testModel(modelId);
      setModelTestById((prev: any) => ({ ...prev, [modelId]: result }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setModelTestById((prev: any) => ({
        ...prev,
        [modelId]: {
          modelId,
          ok: false,
          message,
        },
      }));
    } finally {
      setModelTestActiveId(null);
      setModelTestBusy(false);
    }
  }, [setModelTestActiveId, setModelTestBusy, setModelTestById]);

  const handleTestAllModels = useCallback(async () => {
    const catalog = settings?.modelCatalog ?? [];
    if (catalog.length === 0) {
      return;
    }
    setModelTestBusy(true);
    try {
      for (const model of catalog) {
        setModelTestActiveId(model.id);
        try {
          const result = await testModel(model.id);
          setModelTestById((prev: any) => ({ ...prev, [model.id]: result }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setModelTestById((prev: any) => ({
            ...prev,
            [model.id]: {
              modelId: model.id,
              ok: false,
              message,
            },
          }));
        }
      }
    } finally {
      setModelTestActiveId(null);
      setModelTestBusy(false);
    }
  }, [setModelTestActiveId, setModelTestBusy, setModelTestById, settings?.modelCatalog]);

  const openModelModal = useCallback((mode: "create" | "edit" = "create", model: ModelCatalogItem | null = null) => {
    params.setModelModalMode(mode);
    params.setModelModalInitial(model);
    params.setModelModalOpen(true);
  }, [params]);

  const handleGetModelApiKey = useCallback(async (modelId: string) => {
    const result = await getModelApiKey(modelId);
    return result.apiKey ?? "";
  }, []);

  const handleGenerateGitSummary = useCallback(async (includedPaths: string[]) => {
    return generateGitSummary(activeProjectId, includedPaths);
  }, [activeProjectId]);

  const handleModelModalSubmit = useCallback(async (payload: {
    protocol: {
      id: string;
      displayName: string;
      baseUrl: string;
      apiKey?: string;
      isNew: boolean;
    };
    model: ModelCatalogItem;
    modelApiKey?: string;
    modelApiKeyChanged: boolean;
  }): Promise<{ ok: boolean; message?: string }> => {
    const { protocol, model, modelApiKey, modelApiKeyChanged } = payload;
    if (!settings) {
      return { ok: false, message: "Settings are not loaded yet." };
    }
    cancelPendingAutoSave?.();

    const normalizedKey = modelApiKey?.trim() ?? "";
    const nextProtocols = protocol.isNew
      ? [
          ...settings.modelProtocols,
          {
            id: protocol.id,
            displayName: protocol.displayName,
            baseUrl: protocol.baseUrl,
            apiKeySet: false,
          },
        ]
      : settings.modelProtocols.map((item: any) =>
          item.id === protocol.id
            ? {
                ...item,
                baseUrl: protocol.baseUrl,
              }
            : item,
        );
    const nextCatalog = settings.modelCatalog.some((item: any) => item.id === model.id)
      ? settings.modelCatalog.map((item: any) => (item.id === model.id ? model : item))
      : [...settings.modelCatalog, model];
    const nextSettings = {
      ...settings,
      modelProtocols: nextProtocols,
      modelCatalog: nextCatalog,
    };

    try {
      await runtimeLogWrite("INFO", `model save started: ${model.id}`).catch(() => undefined);
      await persistSettings(nextSettings);
      if (modelApiKeyChanged) {
        const result = await saveModelApiKeyVerified({
          modelId: model.id,
          apiKey: normalizedKey,
        });
        if (!result.ok) {
          const friendlyMessage = resolveCredentialSaveErrorMessage(result, t);
          await runtimeLogWrite(
            "WARN",
            `model key save failed: ${model.id}, stage=${result.stage}, backend=${result.storageBackend}, diagnostic=${result.diagnosticCode ?? "-"}, readback_source=${result.readbackSource ?? "-"}, readback_attempts=${result.readbackAttempts ?? "-"}, reason=${result.message}`,
          ).catch(() => undefined);
          throw new Error(friendlyMessage);
        }

        const readback = await verifyModelApiKeyReadback(model.id, normalizedKey);
        if (!readback.ok) {
          const friendlyMessage = resolveReadbackFailureMessage(readback, t);
          await runtimeLogWrite(
            "ERROR",
            `model key frontend readback failed: ${model.id}, attempts=${readback.attempts}, expected_len=${normalizedKey.length}, actual_len=${readback.keyLength}, source=${readback.source}, diagnostic=${readback.diagnosticCode ?? "-"}`,
          ).catch(() => undefined);
          throw new Error(friendlyMessage);
        }
        await runtimeLogWrite(
          "INFO",
          `model key frontend readback ok: ${model.id}, attempts=${readback.attempts}, key_len=${readback.keyLength}, source=${readback.source}, diagnostic=${readback.diagnosticCode ?? "-"}`,
        ).catch(() => undefined);
      }
      const refreshed = await getSettings();
      setSettings(refreshed);
      setDraftModelApiKeys((current: Record<string, string>) => {
        if (!(model.id in current)) {
          return current;
        }
        const next = { ...current };
        delete next[model.id];
        return next;
      });
      await runtimeLogWrite("INFO", `model save completed: ${model.id}`).catch(() => undefined);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setToast({ type: "error", message });
      await runtimeLogWrite("ERROR", `model save failed: ${model.id}, reason=${message}`).catch(() => undefined);
      return { ok: false, message };
    }
  }, [cancelPendingAutoSave, persistSettings, setDraftModelApiKeys, setSettings, setToast, settings, t]);

  return {
    handleSaveActiveFile,
    handleWindowControlWithGuard,
    handleInitProjectFromFolderWithGuard,
    handleTabSelect,
    handleTabPin,
    handleTabClose,
    handleTabCloseAction,
    handleSelectWorkspacePath,
    openWorkspaceFile,
    handleProjectChange,
    handleIntegrityRepair,
    handleIntegrityCancel,
    handleTestModel,
    handleTestAllModels,
    handleGetModelApiKey,
    openModelModal,
    handleGenerateGitSummary,
    handleModelModalSubmit,
  };
}
