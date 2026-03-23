import { useCallback, useRef, useState } from "react";
import { runtimeLogWrite } from "../../shared/api/runtime";
import { writeFile } from "../../shared/api/workspace";
import type { EditorTab, PendingNavigationIntent, UnsavedChangeItem } from "../../shared/types/app";

type UnsavedGuardParams = {
  selectedFile: string | null;
  setSelectedFile: (value: string | null) => void;
  setEditorTabs: React.Dispatch<React.SetStateAction<EditorTab[]>>;
  setActiveTabId: (value: string | null) => void;
  setPreviewTabId: (value: string | null) => void;
  setDirtyByPath: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setEditorContent: (value: string) => void;
  setToast: (toast: { type: "info" | "error"; message: string } | null) => void;
  editorTabsRef: React.MutableRefObject<EditorTab[]>;
  activeTabIdRef: React.MutableRefObject<string | null>;
  previewTabIdRef: React.MutableRefObject<string | null>;
  dirtyByPathRef: React.MutableRefObject<Record<string, boolean>>;
  savedContentByPathRef: React.MutableRefObject<Record<string, string>>;
  workingContentByPathRef: React.MutableRefObject<Record<string, string>>;
  activeProjectIdRef: React.MutableRefObject<string | null>;
};

export function useUnsavedChangesGuard(params: UnsavedGuardParams) {
  const {
    selectedFile,
    setSelectedFile,
    setEditorTabs,
    setActiveTabId,
    setPreviewTabId,
    setDirtyByPath,
    setEditorContent,
    setToast,
    editorTabsRef,
    activeTabIdRef,
    previewTabIdRef,
    dirtyByPathRef,
    savedContentByPathRef,
    workingContentByPathRef,
    activeProjectIdRef,
  } = params;

  const [unsavedDialogOpen, setUnsavedDialogOpen] = useState(false);
  const [unsavedDialogIntent, setUnsavedDialogIntent] =
    useState<PendingNavigationIntent>("closeTabs");
  const [unsavedDialogItems, setUnsavedDialogItems] = useState<UnsavedChangeItem[]>([]);
  const [unsavedDialogBusy, setUnsavedDialogBusy] = useState(false);

  const pendingUnsavedActionRef = useRef<null | (() => void | Promise<void>)>(null);
  const pendingUnsavedPathsRef = useRef<string[]>([]);

  const resetEditorSession = useCallback(() => {
    setEditorTabs([]);
    setActiveTabId(null);
    setPreviewTabId(null);
    setDirtyByPath({});
    setEditorContent("");
    savedContentByPathRef.current = {};
    workingContentByPathRef.current = {};
    pendingUnsavedActionRef.current = null;
    pendingUnsavedPathsRef.current = [];
    setUnsavedDialogItems([]);
    setUnsavedDialogOpen(false);
    setUnsavedDialogBusy(false);
  }, [
    savedContentByPathRef,
    setActiveTabId,
    setDirtyByPath,
    setEditorContent,
    setEditorTabs,
    setPreviewTabId,
    workingContentByPathRef,
  ]);

  const collectDirtyPaths = useCallback(
    (candidatePaths: string[]) => {
      const unique = Array.from(new Set(candidatePaths.filter((path) => path.trim().length > 0)));
      return unique.filter((path) => dirtyByPathRef.current[path]);
    },
    [dirtyByPathRef],
  );

  const markPathSaved = useCallback(
    (path: string, content: string) => {
      savedContentByPathRef.current[path] = content;
      workingContentByPathRef.current[path] = content;
      setDirtyByPath((prev) => {
        if (!prev[path]) {
          return prev;
        }
        const next = { ...prev };
        delete next[path];
        return next;
      });
    },
    [savedContentByPathRef, setDirtyByPath, workingContentByPathRef],
  );

  const markPathDiscarded = useCallback(
    (path: string) => {
      const saved = savedContentByPathRef.current[path] ?? "";
      workingContentByPathRef.current[path] = saved;
      setDirtyByPath((prev) => {
        if (!prev[path]) {
          return prev;
        }
        const next = { ...prev };
        delete next[path];
        return next;
      });
      if (selectedFile === path) {
        setEditorContent(saved);
      }
    },
    [savedContentByPathRef, selectedFile, setDirtyByPath, setEditorContent, workingContentByPathRef],
  );

  const closeTabsNow = useCallback(
    (tabIds: string[]) => {
      const closing = new Set(tabIds);
      if (closing.size === 0) {
        return;
      }
      const currentTabs = editorTabsRef.current;
      const activeId = activeTabIdRef.current;
      const activeIndex = activeId ? currentTabs.findIndex((tab) => tab.id === activeId) : -1;
      const nextTabs = currentTabs.filter((tab) => !closing.has(tab.id));
      for (const tab of currentTabs) {
        if (!closing.has(tab.id)) {
          continue;
        }
        if (dirtyByPathRef.current[tab.path]) {
          continue;
        }
        delete workingContentByPathRef.current[tab.path];
        delete savedContentByPathRef.current[tab.path];
      }
      let nextActiveId: string | null = activeId;
      if (!nextActiveId || closing.has(nextActiveId)) {
        if (nextTabs.length === 0) {
          nextActiveId = null;
        } else {
          const fallbackIndex =
            activeIndex < 0 ? nextTabs.length - 1 : Math.min(activeIndex, nextTabs.length - 1);
          nextActiveId = nextTabs[fallbackIndex]?.id ?? nextTabs[nextTabs.length - 1]?.id ?? null;
        }
      }
      const currentPreviewId = previewTabIdRef.current;
      const nextPreviewId = currentPreviewId && closing.has(currentPreviewId) ? null : currentPreviewId;

      setEditorTabs(nextTabs);
      setActiveTabId(nextActiveId);
      setPreviewTabId(nextPreviewId);
      const activeTab = nextTabs.find((tab) => tab.id === nextActiveId) ?? null;
      setSelectedFile(activeTab?.path ?? null);
      if (!activeTab) {
        setEditorContent("");
      }
    },
    [
      activeTabIdRef,
      dirtyByPathRef,
      editorTabsRef,
      previewTabIdRef,
      savedContentByPathRef,
      setActiveTabId,
      setEditorContent,
      setEditorTabs,
      setPreviewTabId,
      setSelectedFile,
      workingContentByPathRef,
    ],
  );

  const requestUnsavedGuard = useCallback(
    (
      intent: PendingNavigationIntent,
      candidatePaths: string[],
      onProceed: () => void | Promise<void>,
    ) => {
      const dirtyPaths = collectDirtyPaths(candidatePaths);
      if (dirtyPaths.length === 0) {
        void onProceed();
        return;
      }
      pendingUnsavedActionRef.current = onProceed;
      pendingUnsavedPathsRef.current = dirtyPaths;
      setUnsavedDialogIntent(intent);
      setUnsavedDialogItems(dirtyPaths.map((path) => ({ path })));
      setUnsavedDialogOpen(true);
    },
    [collectDirtyPaths],
  );

  const handleUnsavedDialogCancel = useCallback(() => {
    pendingUnsavedActionRef.current = null;
    pendingUnsavedPathsRef.current = [];
    setUnsavedDialogOpen(false);
  }, []);

  const handleUnsavedDialogDiscardAndContinue = useCallback(async () => {
    const pendingPaths = [...pendingUnsavedPathsRef.current];
    for (const path of pendingPaths) {
      markPathDiscarded(path);
    }
    const action = pendingUnsavedActionRef.current;
    pendingUnsavedActionRef.current = null;
    pendingUnsavedPathsRef.current = [];
    setUnsavedDialogOpen(false);
    if (action) {
      await action();
    }
  }, [markPathDiscarded]);

  const handleUnsavedDialogSaveAndContinue = useCallback(async () => {
    if (!activeProjectIdRef.current) {
      return;
    }
    setUnsavedDialogBusy(true);
    try {
      const projectId = activeProjectIdRef.current;
      const pendingPaths = [...pendingUnsavedPathsRef.current];
      for (const path of pendingPaths) {
        const content = workingContentByPathRef.current[path];
        if (typeof content !== "string") {
          continue;
        }
        await writeFile(projectId, path, content);
        await runtimeLogWrite("INFO", `file saved (unsaved-guard): ${path}`);
        markPathSaved(path, content);
      }
      const action = pendingUnsavedActionRef.current;
      pendingUnsavedActionRef.current = null;
      pendingUnsavedPathsRef.current = [];
      setUnsavedDialogOpen(false);
      if (action) {
        await action();
      }
    } catch (error) {
      setToast({ type: "error", message: String(error) });
    } finally {
      setUnsavedDialogBusy(false);
    }
  }, [activeProjectIdRef, markPathSaved, setToast, workingContentByPathRef]);

  return {
    unsavedDialogOpen,
    unsavedDialogIntent,
    unsavedDialogItems,
    unsavedDialogBusy,
    resetEditorSession,
    collectDirtyPaths,
    markPathSaved,
    markPathDiscarded,
    closeTabsNow,
    requestUnsavedGuard,
    handleUnsavedDialogCancel,
    handleUnsavedDialogDiscardAndContinue,
    handleUnsavedDialogSaveAndContinue,
  };
}
