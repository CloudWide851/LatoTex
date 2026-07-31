import type React from "react";
import { getLibraryTree } from "../../shared/api/library";
import { runtimeLogWrite } from "../../shared/api/runtime";
import { fsOperation, getWorkspaceTree } from "../../shared/api/workspace";
import type { Locale } from "../../i18n";
import type { AppSettings, FsAction, FsScope, ResourceNode } from "../../shared/types/app";
import { applyOptimisticFsAction } from "./fsTreeOptimistic";
import { rewriteSelectionAfterFsAction } from "./librarySelectionState";
import type { DeleteIntent, TranslationFn } from "./useAppHandlers.types";
import { workspaceFsFailureMessage } from "./workspaceFsFailure";
import {
  knowledgeFailureMessage,
  requestKnowledgeMutationApproval,
} from "./knowledgeMutationApproval";

export function useFsActionHandlers(params: {
  activeProjectId: string | null;
  deleteDontAskAgain: boolean;
  deleteIntent: DeleteIntent;
  locale: Locale;
  persistSettings: (settings: AppSettings) => Promise<AppSettings>;
  refreshGitWorkspace: (projectIdOverride?: string) => Promise<void>;
  setDeleteDontAskAgain: (value: boolean) => void;
  setDeleteIntent: (value: DeleteIntent) => void;
  setLibraryTree: React.Dispatch<React.SetStateAction<ResourceNode[]>>;
  setSelectedFile: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedLibraryPath: React.Dispatch<React.SetStateAction<string | null>>;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings | null>>;
  setToast: (value: { type: "info" | "error"; message: string } | null) => void;
  setTree: React.Dispatch<React.SetStateAction<ResourceNode[]>>;
  settings: AppSettings | null;
  t: TranslationFn;
}) {
  const {
    activeProjectId,
    deleteDontAskAgain,
    deleteIntent,
    locale,
    persistSettings,
    refreshGitWorkspace,
    setDeleteDontAskAgain,
    setDeleteIntent,
    setLibraryTree,
    setSelectedFile,
    setSelectedLibraryPath,
    setSettings,
    setToast,
    setTree,
    settings,
    t,
  } = params;

  const runFsAction = async (
    scope: FsScope,
    action: FsAction,
    path: string,
    targetPath?: string,
    content?: string,
  ): Promise<boolean> => {
    if (!activeProjectId) {
      return false;
    }
    try {
      const needsKnowledgeApproval = action === "rename" || action === "move" || action === "delete";
      const knowledgeApprovalToken = needsKnowledgeApproval
        ? await requestKnowledgeMutationApproval({
            projectId: activeProjectId,
            scope,
            action,
            path,
            targetPath,
            t,
          })
        : undefined;
      if (knowledgeApprovalToken === null) {
        return false;
      }
      await fsOperation({
        projectId: activeProjectId,
        scope,
        action,
        path,
        targetPath,
        content,
        knowledgeApprovalToken,
      });
      if (scope === "workspace") {
        setTree((current) => applyOptimisticFsAction({ tree: current, action, path, targetPath }));
        setSelectedFile((current) => rewriteSelectionAfterFsAction({ selectedPath: current, action, path, targetPath }));
        void getWorkspaceTree(activeProjectId)
          .then(setTree)
          .catch((error) => void runtimeLogWrite("WARN", `workspace tree refresh after fs action failed: ${String(error)}`).catch(() => undefined));
        void refreshGitWorkspace(activeProjectId).catch(() => undefined);
        window.dispatchEvent(new CustomEvent("latotex.workspace.fs", {
          detail: { scope, action, path, targetPath },
        }));
      } else {
        setLibraryTree((current) => applyOptimisticFsAction({ tree: current, action, path, targetPath }));
        setSelectedLibraryPath((current) => rewriteSelectionAfterFsAction({ selectedPath: current, action, path, targetPath }));
        void getLibraryTree(activeProjectId)
          .then(setLibraryTree)
          .catch((error) => void runtimeLogWrite("WARN", `library tree refresh after fs action failed: ${String(error)}`).catch(() => undefined));
      }
      setToast({ type: "info", message: t("toast.fsUpdated") });
      return true;
    } catch (error) {
      const message = String(error).includes("knowledge.")
        ? knowledgeFailureMessage(error, t)
        : workspaceFsFailureMessage(error, t);
      setToast({ type: "error", message });
      return false;
    }
  };

  const requestFsAction = async (
    scope: FsScope,
    action: FsAction,
    path: string,
    targetPath?: string,
    content?: string,
  ) => {
    const normalizedPath = path.trim();
    if (!normalizedPath) {
      return;
    }
    if (action !== "delete") {
      await runFsAction(scope, action, normalizedPath, targetPath, content);
      return;
    }
    if (settings?.uiPrefs?.skipDeleteConfirm ?? false) {
      await runFsAction(scope, "delete", normalizedPath);
      return;
    }
    setDeleteIntent({ scope, path: normalizedPath });
    setDeleteDontAskAgain(false);
  };

  const confirmDelete = async () => {
    if (!deleteIntent) {
      return;
    }
    if (deleteDontAskAgain && settings) {
      const nextSettings: AppSettings = {
        ...settings,
        uiPrefs: {
          ...(settings.uiPrefs ?? {}),
          language: settings.uiPrefs?.language ?? locale,
          skipDeleteConfirm: true,
          panelLayout: settings.uiPrefs?.panelLayout,
        },
      };
      await persistSettings(nextSettings);
      setSettings(nextSettings);
    }
    await runFsAction(deleteIntent.scope, "delete", deleteIntent.path);
    setDeleteIntent(null);
  };

  return { confirmDelete, requestFsAction, runFsAction };
}
