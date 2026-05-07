import { useEffect, useRef } from "react";
import { runtimeLogWrite } from "../../shared/api/runtime";
import type { EditorTab } from "../../shared/types/app";
import { resolveLatexWorkspaceRestore } from "../components/workspace/latexWorkspaceSession";

export function useLatexWorkspaceSessionRestore(params: {
  activeProjectId: string | null;
  fileSet: Set<string>;
  selectedFile: string | null;
  editorTabsRef: React.MutableRefObject<EditorTab[]>;
  buildEditorTab: (path: string, pinned: boolean, preview: boolean) => EditorTab;
  setEditorTabs: React.Dispatch<React.SetStateAction<EditorTab[]>>;
  setActiveTabId: (value: string | null) => void;
  setPreviewTabId: (value: string | null) => void;
  setPreferCompiledPreview: (value: boolean) => void;
  setPreviewOverridePath: (value: string | null) => void;
  setSelectedFile: (value: string | null) => void;
}) {
  const {
    activeProjectId,
    fileSet,
    selectedFile,
    editorTabsRef,
    buildEditorTab,
    setEditorTabs,
    setActiveTabId,
    setPreviewTabId,
    setPreferCompiledPreview,
    setPreviewOverridePath,
    setSelectedFile,
  } = params;
  const restoredProjectRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeProjectId || fileSet.size === 0) {
      return;
    }
    if (restoredProjectRef.current === activeProjectId) {
      return;
    }
    if (editorTabsRef.current.length > 0) {
      restoredProjectRef.current = activeProjectId;
      return;
    }
    restoredProjectRef.current = activeProjectId;
    const restored = resolveLatexWorkspaceRestore(activeProjectId, fileSet, selectedFile);
    if (restored.tabPaths.length === 0 || !restored.activePath) {
      void runtimeLogWrite("INFO", `latex_workspace_restore_empty: project=${activeProjectId}`).catch(() => undefined);
      return;
    }
    const tabs = restored.tabPaths.map((path) => buildEditorTab(path, true, false));
    const activeTab = tabs.find((tab) => tab.path === restored.activePath) ?? tabs[0] ?? null;
    setEditorTabs(tabs);
    setActiveTabId(activeTab?.id ?? null);
    setPreviewTabId(null);
    setPreferCompiledPreview(false);
    setPreviewOverridePath(null);
    setSelectedFile(activeTab?.path ?? null);
    void runtimeLogWrite(
      "INFO",
      `latex_workspace_restore: project=${activeProjectId}, tabs=${tabs.length}, active=${activeTab?.path ?? "-"}`,
    ).catch(() => undefined);
  }, [
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
  ]);

  useEffect(() => {
    if (!activeProjectId) {
      restoredProjectRef.current = null;
    }
  }, [activeProjectId]);
}
