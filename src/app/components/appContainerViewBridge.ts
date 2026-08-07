import type { useAppContainerState } from "../hooks/useAppContainerState";
import type { useAppHandlers } from "../hooks/useAppHandlers";
import type { useAppPanelNodes } from "../hooks/useAppPanelNodes";
import type { AppContainerViewProps } from "./appContainerViewTypes";

type AppContainerState = ReturnType<typeof useAppContainerState>;
type AppHandlers = ReturnType<typeof useAppHandlers>;
type AppPanelNodes = ReturnType<typeof useAppPanelNodes>;

type AppContainerViewBridge = Pick<
  AppContainerViewProps,
  | "latexTerminalLayout"
  | "libraryBibLayout"
  | "setSettings"
  | "compiledPdfRelativePath"
  | "selectedImagePreviewUrl"
  | "previewOverridePath"
  | "compileBusy"
  | "compileInstallProgress"
  | "agentPendingAction"
  | "handleResolveAgentPendingAction"
  | "handleWriteSelectedFileContent"
  | "handleLibrarySyncZotero"
  | "handleWorkspaceRescan"
  | "runFsAction"
>;

export function createAppContainerViewBridge(
  state: AppContainerState,
  panels: AppPanelNodes,
  handlers: AppHandlers,
): AppContainerViewBridge {
  return {
    latexTerminalLayout: panels.latexTerminalLayout,
    libraryBibLayout: panels.libraryBibLayout,
    setSettings: state.setSettings,
    compiledPdfRelativePath: state.compiledPdfRelativePath,
    selectedImagePreviewUrl: state.selectedImagePreviewUrl,
    previewOverridePath: state.previewOverridePath,
    compileBusy: handlers.compileBusy,
    compileInstallProgress: state.compileInstallProgress,
    agentPendingAction: state.agentPendingAction,
    handleResolveAgentPendingAction: handlers.handleResolveAgentPendingAction,
    handleWriteSelectedFileContent: handlers.handleWriteSelectedFileContent,
    handleLibrarySyncZotero: handlers.handleLibrarySyncZotero,
    handleWorkspaceRescan: handlers.handleWorkspaceRescan,
    runFsAction: handlers.runFsAction,
  };
}
