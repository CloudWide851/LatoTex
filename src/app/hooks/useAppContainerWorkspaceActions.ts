import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useCallback, useEffect } from "react";
import { windowSyncIcon } from "../../shared/api/app";
import { projectIntegrityRepair, projectIntegrityStatus } from "../../shared/api/projects";
import { runtimeLogWrite } from "../../shared/api/runtime";
import { isImagePath, isPdfPath } from "../../shared/utils/fileKind";
import type { CloseTabsAction } from "../../shared/types/app";
import { getTabIdsByAction } from "./useEditorTabs";
import type { AppContainerWorkspaceActionsResult, UseAppContainerWorkspaceActionsParams } from "./useAppContainerWorkspaceActions.types";
import { useNativeWindowCloseInterception } from "./windowCloseRequest";
import { resolveWindowCloseRequestPlan, type CloseBehavior } from "./windowCloseFlow";
import { useWorkspaceShortcuts } from "./useWorkspaceShortcuts";
import { useLatexWorkspaceSessionRestore } from "./useLatexWorkspaceSessionRestore";
import { useModelSettingsActions } from "./useModelSettingsActions";

export function useAppContainerWorkspaceActions(
  params: UseAppContainerWorkspaceActionsParams,
): AppContainerWorkspaceActionsResult {
  const {
    selectedFile,
    editorContent,
    markPathSaved,
    handleSaveFile,
    handleWindowControl,
    requestUnsavedGuard,
    editorTabsRef,
    allowNextWindowCloseRef,
    handleInitProjectFromFolder,
    resetEditorSession,
    handleEditorUndo,
    handleEditorRedo,
    handleCompile,
    handleExportCompiledPdf,
    isTauriRuntime,
    collectDirtyPaths,
    setEditorTabs,
    setPreferCompiledPreview,
    previewTabIdRef,
    setPreviewTabId,
    closeTabsNow,
    dirtyByPathRef,
    fileSet,
    activeTabIdRef,
    setActiveTabId,
    buildEditorTab,
    setSelectedFile,
    setPreviewOverridePath,
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
  } = params;
  const modelActions = useModelSettingsActions({
    activeProjectId,
    settings,
    setModelTestById: params.setModelTestById,
    setModelTestActiveId: params.setModelTestActiveId,
    setModelTestBusy: params.setModelTestBusy,
    persistSettings: params.persistSettings,
    cancelPendingAutoSave: params.cancelPendingAutoSave,
    setSettings: params.setSettings,
    setDraftModelApiKeys: params.setDraftModelApiKeys,
    setToast,
    t,
    setModelModalMode: params.setModelModalMode,
    setModelModalInitial: params.setModelModalInitial,
    setModelModalOpen: params.setModelModalOpen,
  });

  const handleSaveActiveFile = useCallback(async () => {
    const ok = await handleSaveFile();
    if (ok && selectedFile && !isPdfPath(selectedFile)) {
      markPathSaved(selectedFile, editorContent);
    }
    return ok;
  }, [editorContent, handleSaveFile, markPathSaved, selectedFile]);

  const handleCloseWindowRequest = useCallback(() => {
    const candidatePaths = editorTabsRef.current.map((tab: any) => tab.path);
    const dirtyPaths = collectDirtyPaths(candidatePaths);
    const plan = resolveWindowCloseRequestPlan(candidatePaths, dirtyPaths);
    if (plan.type === "request-unsaved-guard") {
      requestUnsavedGuard("closeWindow", plan.candidatePaths, async () => {
        await handleWindowControl("close");
      });
      return;
    }
    void handleWindowControl("close");
  }, [collectDirtyPaths, editorTabsRef, handleWindowControl, requestUnsavedGuard]);

  const handleWindowControlWithGuard = useCallback((action: "minimize" | "toggle" | "close") => {
    if (action !== "close") {
      void handleWindowControl(action);
      return;
    }
    handleCloseWindowRequest();
  }, [handleCloseWindowRequest, handleWindowControl]);

  const closeBehavior = (settings?.uiPrefs?.closeBehavior ?? "ask") as CloseBehavior;

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

  useNativeWindowCloseInterception({
    isTauriRuntime,
    closeBehavior,
    editorTabsRef,
    allowNextWindowCloseRef,
    collectDirtyPaths,
    requestUnsavedGuard,
    onDelegateClose: async () => {
      await handleWindowControl("close");
    },
  });

  const activateTabById = useCallback((tabId: string) => {
    const target = editorTabsRef.current.find((tab: any) => tab.id === tabId);
    if (!target) {
      void runtimeLogWrite("WARN", `editor_tab_activate_missing: tabId=${tabId}`).catch(() => undefined);
      return;
    }
    setEditorTabs((prev: any[]) =>
      prev.map((tab) => (tab.id === tabId ? { ...tab, lastAccessed: Date.now() } : tab)),
    );
    setActiveTabId(tabId);
    setPreferCompiledPreview(false);
    setPreviewOverridePath(null);
    setSelectedFile(target.path);
    void runtimeLogWrite("INFO", `editor_tab_activate: path=${target.path}, tabId=${tabId}`).catch(() => undefined);
  }, [editorTabsRef, setActiveTabId, setEditorTabs, setPreferCompiledPreview, setPreviewOverridePath, setSelectedFile]);

  const handleTabSelect = useCallback((tabId: string) => {
    activateTabById(tabId);
  }, [activateTabById]);

  const openWorkspaceFile = useCallback((path: string, mode: "preview" | "pinned" = "preview") => {
    if (!path || !fileSet.has(path)) {
      void runtimeLogWrite("WARN", `editor_file_open_rejected: path=${path || "-"}, reason=missing_from_tree`).catch(() => undefined);
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
      void runtimeLogWrite("INFO", `editor_file_open_existing: path=${path}, mode=${mode}, tabId=${existing.id}`).catch(() => undefined);
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
      setPreferCompiledPreview(false);
      setPreviewOverridePath(null);
      setSelectedFile(path);
      setPreviewTabId(mode === "preview" ? newTab.id : previewTabIdRef.current);
      void runtimeLogWrite("INFO", `editor_file_open_new: path=${path}, mode=${mode}, tabId=${newTab.id}`).catch(() => undefined);
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
  }, [activateTabById, buildEditorTab, editorTabsRef, fileSet, previewTabIdRef, requestUnsavedGuard, setActiveTabId, setEditorTabs, setPreferCompiledPreview, setPreviewOverridePath, setPreviewTabId, setSelectedFile]);

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
      void runtimeLogWrite("WARN", `editor_tab_close_missing: tabId=${tabId}`).catch(() => undefined);
      return;
    }
    void runtimeLogWrite("INFO", `editor_tab_close_requested: path=${tab.path}, tabId=${tabId}`).catch(() => undefined);
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
    const normalized = String(path ?? "").trim();
    if (!normalized) {
      setSelectedFile(null);
      setPreviewOverridePath(null);
      setPreferCompiledPreview(false);
      return;
    }
    if (isImagePath(normalized)) {
      setPreviewOverridePath(normalized);
      setPreferCompiledPreview(false);
      return;
    }
    if (!fileSet.has(normalized)) {
      setPreviewOverridePath(null);
      setPreferCompiledPreview(false);
      return;
    }
    setPreviewOverridePath(null);
    openWorkspaceFile(normalized, "pinned");
    if (selectedFile !== normalized) {
      setSelectedFile(normalized);
    }
  }, [fileSet, openWorkspaceFile, selectedFile, setPreferCompiledPreview, setPreviewOverridePath, setSelectedFile]);

  useLatexWorkspaceSessionRestore({
    activeProjectId,
    buildEditorTab,
    editorTabsRef,
    fileSet,
    selectedFile,
    setActiveTabId,
    setEditorTabs,
    setPreferCompiledPreview,
    setPreviewOverridePath,
    setPreviewTabId,
    setSelectedFile,
  });

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
        const closedProjectId = activeProjectIdRef.current;
        if (typeof window !== "undefined" && closedProjectId) {
          window.dispatchEvent(
            new CustomEvent("latotex.project.closed", {
              detail: { projectId: closedProjectId },
            }),
          );
        }
        setIntegrityIssue(null);
        resetEditorSession();
        setPreviewOverridePath(null);
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
      setPreviewOverridePath(null);
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
    handleTestModel: modelActions.handleTestModel,
    handleTestAllModels: modelActions.handleTestAllModels,
    handleGetModelApiKey: modelActions.handleGetModelApiKey,
    openModelModal: modelActions.openModelModal,
    handleGenerateGitSummary: modelActions.handleGenerateGitSummary,
    handleModelModalSubmit: modelActions.handleModelModalSubmit,
  };
}






