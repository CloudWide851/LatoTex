import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { AppSettings, ProjectSearchHit } from "../../shared/types/app";
import type { AppOverlaysProps } from "./AppOverlays";
import type { AppTopbarProps } from "./AppTopbar";
import type { UnsavedChangesDialogProps } from "./editor/UnsavedChangesDialog";
import type { AppWorkspaceShellProps } from "./workspace/workspaceShellTypes";
import type { ResearchAgentRuntimeProjection } from "../hooks/useResearchAgentRuntime";

type WorkspaceValueProps = Pick<
  AppWorkspaceShellProps,
  | "page"
  | "pageRailItems"
  | "activeProjectId"
  | "busy"
  | "shellLayout"
  | "latexLayout"
  | "analysisLayout"
  | "libraryLayout"
  | "tree"
  | "libraryTree"
  | "selectedFile"
  | "selectedLibraryPath"
  | "fileList"
  | "editorContent"
  | "editorTabs"
  | "activeTabId"
  | "dirtyByPath"
  | "preferCompiledPreview"
  | "compileErrorLine"
  | "compileDiagnostics"
  | "compileBusy"
  | "agentCollapsed"
  | "agentPhase"
  | "agentStatusKey"
  | "agentPrompt"
  | "agentMessages"
  | "agentProposal"
  | "agentRunId"
  | "agentSessions"
  | "agentSessionPickerOpen"
  | "agentSessionPickerIndex"
  | "agentRollbackVisible"
  | "events"
  | "explorerGitDecorations"
  | "agentResourceLocks"
  | "settings"
  | "settingsPanel"
  | "gitPanel"
  | "analysisPanel"
  | "agentPanel"
  | "shareSession"
  | "sharePassword"
  | "shareBusy"
  | "shareSyncing"
  | "analysisRunning"
>;

type OptionalWorkspaceValueProps = Partial<Pick<
  AppWorkspaceShellProps,
  | "latexTerminalLayout"
  | "libraryBibLayout"
  | "compiledPdfRelativePath"
  | "selectedImagePreviewUrl"
  | "previewOverridePath"
  | "compileInstallProgress"
  | "agentPendingAction"
  | "shareConflict"
  | "shareComments"
  | "shareEditAnnotations"
  | "shareMode"
  | "shareSessionName"
  | "libraryViewMode"
>>;

type OverlayValueProps = Pick<
  AppOverlaysProps,
  | "overlay"
  | "logsTab"
  | "modelModalOpen"
  | "modelModalMode"
  | "modelModalInitial"
  | "deleteIntent"
  | "deleteDontAskAgain"
  | "integrityIssue"
  | "projectDeleteConfirmIntent"
  | "projectDeleteConfirmBusy"
  | "themeTransition"
  | "toast"
  | "closeBehaviorDialogOpen"
  | "closeBehaviorDialogBusy"
>;

export type AppContainerViewProps = WorkspaceValueProps
  & OptionalWorkspaceValueProps
  & OverlayValueProps
  & Pick<
    AppTopbarProps,
    | "status"
    | "logoMark"
    | "projects"
    | "isTauriRuntime"
    | "windowActionBusy"
    | "isMaximized"
    | "projectSearchQuery"
    | "projectSearchBusy"
    | "projectSearchSearched"
    | "projectSearchResults"
  >
  & {
    sleeping: boolean;
    suspended: boolean;
    startupReady: boolean;
    onWakeFromSleep: () => void;
    recoverWorkspaceLayout: () => void;
    pdfUrl: AppWorkspaceShellProps["compiledPdfUrl"];
    selectedFilePdfUrl: AppWorkspaceShellProps["selectedFilePdfUrl"];
    SHELL_MIN: AppWorkspaceShellProps["shellMin"];
    t: AppWorkspaceShellProps["t"];
    setSettings: Dispatch<SetStateAction<AppSettings | null>>;
    researchAgentRuntime: ResearchAgentRuntimeProjection;

    handleProjectChange: AppTopbarProps["onProjectChange"];
    handleProjectDelete: AppTopbarProps["onProjectDelete"];
    setProjectSearchQuery: Dispatch<SetStateAction<string>>;
    handleProjectSearch: AppTopbarProps["onProjectSearch"];
    handleProjectSearchSelect: (hit: ProjectSearchHit) => void;
    setProjectSearchResults: Dispatch<SetStateAction<ProjectSearchHit[]>>;
    setProjectSearchSearched: Dispatch<SetStateAction<boolean>>;
    handleInitProjectFromFolderWithGuard: AppTopbarProps["onOpenFolder"];
    handleCreateSampleProject: AppWorkspaceShellProps["onCreateSample"];
    handleOnboardingDismiss: AppWorkspaceShellProps["onOnboardingDismiss"];
    handlePdfViewed: AppWorkspaceShellProps["onPdfViewed"];
    handleWindowControlWithGuard: AppTopbarProps["onWindowControl"];

    handleShareStart: AppWorkspaceShellProps["onShareStart"];
    handleShareStop: AppWorkspaceShellProps["onShareStop"];
    handleShareRefresh: AppWorkspaceShellProps["onShareRefresh"];
    handleSharePasswordReveal: AppWorkspaceShellProps["onSharePasswordReveal"];
    handleShareModeChange?: AppWorkspaceShellProps["onShareModeChange"];
    handleShareSessionNameChange?: AppWorkspaceShellProps["onShareSessionNameChange"];
    handleShareConflictResolve?: AppWorkspaceShellProps["onShareConflictResolve"];

    setPage: AppWorkspaceShellProps["onPageChange"];
    handleSelectWorkspacePath: AppWorkspaceShellProps["onSelectFile"];
    setSelectedLibraryPath: AppWorkspaceShellProps["onSelectLibraryPath"];
    setEditorContent: AppWorkspaceShellProps["onEditorChange"];
    handleTabSelect: AppWorkspaceShellProps["onTabSelect"];
    handleTabClose: AppWorkspaceShellProps["onTabClose"];
    handleTabCloseAction: AppWorkspaceShellProps["onTabCloseAction"];
    handleTabPin: AppWorkspaceShellProps["onTabPin"];
    editorRef: MutableRefObject<Parameters<AppWorkspaceShellProps["onEditorMount"]>[0] | null>;
    setAgentPrompt: AppWorkspaceShellProps["onAgentPromptChange"];
    setAgentCollapsed: Dispatch<SetStateAction<boolean>>;
    handleRunAgent: AppWorkspaceShellProps["onAgentRun"];
    setAgentSessionPickerOpen: AppWorkspaceShellProps["onAgentSessionPickerOpenChange"];
    setAgentSessionPickerIndex: AppWorkspaceShellProps["onAgentSessionPickerIndexChange"];
    handleAgentSessionConfirm: AppWorkspaceShellProps["onAgentSessionConfirm"];
    handleAgentRollback: AppWorkspaceShellProps["onAgentRollback"];
    handleAcceptAgentProposal: (withAnalysis: boolean) => void | Promise<void>;
    handleRejectAgentProposal: AppWorkspaceShellProps["onAgentRejectProposal"];
    handleResolveAgentPendingAction?: AppWorkspaceShellProps["onAgentPendingActionResolve"];
    handleSaveActiveFile: AppWorkspaceShellProps["onSaveFile"];
    handleWriteSelectedFileContent?: AppWorkspaceShellProps["onWriteSelectedFileContent"];
    handleCompile: AppWorkspaceShellProps["onCompile"];
    handleExportCompiledPdf: AppWorkspaceShellProps["onExportPdf"];
    handleEditorUndo: AppWorkspaceShellProps["onEditorUndo"];
    handleEditorRedo: AppWorkspaceShellProps["onEditorRedo"];
    setLogsTab: AppOverlaysProps["onLogsTabChange"];
    setOverlay: (overlay: AppOverlaysProps["overlay"]) => void;
    handleLibraryRescan: AppWorkspaceShellProps["onLibraryRescan"];
    handleLibraryImportPdf: AppWorkspaceShellProps["onLibraryImportPdf"];
    handleLibraryImportLink: AppWorkspaceShellProps["onLibraryImportLink"];
    handleLibrarySyncZotero?: AppWorkspaceShellProps["onLibrarySyncZotero"];
    handleLibraryAnalyzePaper: AppWorkspaceShellProps["onLibraryAnalyzePaper"];
    handleLibraryViewModeChange?: AppWorkspaceShellProps["onLibraryViewModeChange"];
    handleWorkspaceRevealInSystem: AppWorkspaceShellProps["onWorkspaceRevealInSystem"];
    handleWorkspaceOpenTerminal: AppWorkspaceShellProps["onWorkspaceOpenTerminal"];
    handleWorkspaceRescan?: AppWorkspaceShellProps["onWorkspaceRescan"];
    savePanelLayout: AppWorkspaceShellProps["onSavePanelLayout"];
    requestFsAction: AppWorkspaceShellProps["onFsAction"];
    runFsAction?: AppWorkspaceShellProps["onRunFsAction"];

    analysisEnvPrompt?: AppOverlaysProps["analysisEnvPrompt"];
    setModelModalOpen: Dispatch<SetStateAction<boolean>>;
    setModelModalInitial: Dispatch<SetStateAction<AppOverlaysProps["modelModalInitial"]>>;
    setModelModalMode: Dispatch<SetStateAction<AppOverlaysProps["modelModalMode"]>>;
    handleModelModalSubmit: AppOverlaysProps["onModelSubmit"];
    handleGetModelApiKey: AppOverlaysProps["onGetModelApiKey"];
    setDeleteIntent: AppOverlaysProps["onDeleteCancel"] extends () => void
      ? Dispatch<SetStateAction<AppOverlaysProps["deleteIntent"]>>
      : never;
    confirmDelete: AppOverlaysProps["onDeleteConfirm"];
    setDeleteDontAskAgain: AppOverlaysProps["onDeleteDontAskChange"];
    handleIntegrityCancel: AppOverlaysProps["onIntegrityCancel"];
    handleIntegrityRepair: AppOverlaysProps["onIntegrityRepair"];
    handleProjectDeleteConfirmCancel: AppOverlaysProps["onProjectDeleteConfirmCancel"];
    handleProjectDeleteConfirm: AppOverlaysProps["onProjectDeleteConfirm"];
    closeBehaviorRememberChoice: boolean;
    setCloseBehaviorRememberChoice: AppOverlaysProps["onCloseBehaviorRememberChange"];
    handleCloseBehaviorDialogCancel: AppOverlaysProps["onCloseBehaviorCancel"];
    handleCloseBehaviorDialogResolve: AppOverlaysProps["onCloseBehaviorConfirm"];

    unsavedDialogOpen: UnsavedChangesDialogProps["open"];
    unsavedDialogIntent: UnsavedChangesDialogProps["intent"];
    unsavedDialogItems: UnsavedChangesDialogProps["items"];
    unsavedDialogBusy: UnsavedChangesDialogProps["busy"];
    handleUnsavedDialogSaveAndContinue: () => void | Promise<void>;
    handleUnsavedDialogDiscardAndContinue: () => void | Promise<void>;
    handleUnsavedDialogCancel: UnsavedChangesDialogProps["onCancel"];
  };
