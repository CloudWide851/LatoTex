import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { AppSettings, CloseTabsAction, EditorTab, ModelCatalogItem } from "../../shared/types/app";
import type { ProjectIntegrityIssue } from "./useProjectDataLoader";
import type { TranslationFn } from "../types/i18n";

export type ModelTestResultMap = Record<string, { modelId: string; ok: boolean; message: string }>;

export type UseAppContainerWorkspaceActionsParams = {
  selectedFile: string | null;
  editorContent: string;
  markPathSaved: (path: string, content: string) => void;
  handleSaveFile: () => Promise<boolean>;
  handleWindowControl: (action: "minimize" | "toggle" | "close") => Promise<void>;
  requestUnsavedGuard: (
    intent: "switchFile" | "switchProject" | "closeWindow" | "closeTabs",
    candidatePaths: string[],
    onContinue: () => void | Promise<void>,
  ) => void;
  editorTabsRef: MutableRefObject<EditorTab[]>;
  handleInitProjectFromFolder: () => Promise<void>;
  resetEditorSession: () => void;
  handleEditorUndo: () => void;
  handleEditorRedo: () => void;
  handleCompile: () => Promise<void>;
  handleExportCompiledPdf: () => Promise<void>;
  isTauriRuntime: boolean;
  collectDirtyPaths: (candidatePaths: string[]) => string[];
  setEditorTabs: Dispatch<SetStateAction<EditorTab[]>>;
  setPreferCompiledPreview: (value: boolean) => void;
  previewTabIdRef: MutableRefObject<string | null>;
  setPreviewTabId: (value: string | null) => void;
  closeTabsNow: (tabIds: string[]) => void;
  dirtyByPathRef: MutableRefObject<Record<string, boolean>>;
  fileSet: Set<string>;
  activeTabIdRef: MutableRefObject<string | null>;
  setActiveTabId: (value: string | null) => void;
  buildEditorTab: (path: string, pinned: boolean, preview: boolean) => EditorTab;
  setSelectedFile: (value: string | null) => void;
  setPreviewOverridePath: (value: string | null) => void;
  activeProjectIdRef: MutableRefObject<string | null>;
  integrityCheckedRef: MutableRefObject<Set<string>>;
  integrityIssue: ProjectIntegrityIssue | null;
  setIntegrityIssue: Dispatch<SetStateAction<ProjectIntegrityIssue | null>>;
  setToast: (value: { type: "info" | "error"; message: string } | null) => void;
  setActiveProjectId: (value: string | null) => void;
  loadProjectData: (projectId: string) => Promise<void>;
  setBusy: (value: boolean) => void;
  t: TranslationFn;
  lastLoadedProjectIdRef: MutableRefObject<string | null>;
  activeProjectId: string | null;
  settings: AppSettings | null;
  setModelTestById: Dispatch<SetStateAction<ModelTestResultMap>>;
  setModelTestActiveId: (value: string | null) => void;
  setModelTestBusy: (value: boolean) => void;
  persistSettings: (settings: AppSettings) => Promise<AppSettings>;
  cancelPendingAutoSave?: (() => void) | undefined;
  setSettings: Dispatch<SetStateAction<AppSettings | null>>;
  setDraftModelApiKeys: Dispatch<SetStateAction<Record<string, string>>>;
  setModelModalMode: (value: "create" | "edit") => void;
  setModelModalInitial: (value: ModelCatalogItem | null) => void;
  setModelModalOpen: (value: boolean) => void;
};

export type AppContainerWorkspaceActionsResult = {
  handleSaveActiveFile: () => Promise<boolean>;
  handleWindowControlWithGuard: (action: "minimize" | "toggle" | "close") => void;
  handleInitProjectFromFolderWithGuard: () => void;
  handleTabSelect: (tabId: string) => void;
  handleTabPin: (tabId: string) => void;
  handleTabClose: (tabId: string) => void;
  handleTabCloseAction: (action: CloseTabsAction, referenceTabId: string) => void;
  handleSelectWorkspacePath: (path: string | null) => void;
  openWorkspaceFile: (path: string, mode?: "preview" | "pinned") => void;
  handleProjectChange: (projectId: string | null) => void;
  handleIntegrityRepair: () => Promise<void>;
  handleIntegrityCancel: () => void;
  handleTestModel: (modelId: string) => Promise<void>;
  handleTestAllModels: () => Promise<void>;
  handleGetModelApiKey: (modelId: string) => Promise<string>;
  openModelModal: (mode?: "create" | "edit", model?: ModelCatalogItem | null) => void;
  handleGenerateGitSummary: (includedPaths: string[]) => Promise<string>;
  handleModelModalSubmit: (payload: {
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
  }) => Promise<{ ok: boolean; message?: string }>;
};
