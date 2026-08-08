import { Suspense, type ReactNode } from "react";
import type { AgentRuntimeId } from "../../../shared/types/agentControl";
import { NoProjectPanel } from "./NoProjectPanel";
import {
  LazyDrawWorkspace,
  LazyPluginMarketplaceSurface,
  LazyProjectOverviewWorkspaceSurface,
  LazySubmissionCiWorkspaceSurface,
  WorkspacePanelFallback,
} from "./workspaceShellLazy";
import type { AppWorkspaceShellProps } from "./workspaceShellTypes";

export function renderWorkspaceSpecialPage(input: {
  shell: AppWorkspaceShellProps;
  selectedIsDraw: boolean;
  selectedIsExcel: boolean;
  compileAssistDiagnostics: string[];
  onOpenAgentRuntimeTerminal: (runtimeId: AgentRuntimeId) => void;
  onOpenTexMode: () => void;
}): ReactNode | undefined {
  const {
    shell,
    selectedIsDraw,
    selectedIsExcel,
    compileAssistDiagnostics,
    onOpenAgentRuntimeTerminal,
    onOpenTexMode,
  } = input;
  const {
    page,
    activeProjectId,
    analysisPanel,
    agentPanel,
    gitPanel,
    settingsPanel,
    busy,
    selectedFile,
    settings,
    onSelectFile,
    onRunFsAction,
    onOpenFolder,
    onCreateSample,
    onPageChange,
    t,
  } = shell;
  const noProject = (
    <NoProjectPanel busy={busy} onOpenFolder={onOpenFolder} onCreateSample={onCreateSample} t={t} />
  );

  if (page === "overview") {
    return activeProjectId ? <LazyProjectOverviewWorkspaceSurface shell={shell} /> : noProject;
  }
  if (page === "analysis") {
    return <section className="h-full min-h-0">{analysisPanel}</section>;
  }
  if (page === "agents") {
    return <section className="h-full min-h-0">{agentPanel}</section>;
  }
  if (page === "draw") {
    return (
      <Suspense fallback={<WorkspacePanelFallback label={t("common.loading")} />}>
        <LazyDrawWorkspace
          projectId={activeProjectId}
          selectedPath={selectedFile}
          onSelectPath={onSelectFile}
          onRunFsAction={onRunFsAction}
          t={t}
        />
      </Suspense>
    );
  }
  if (page === "library") {
    return noProject;
  }
  if (page === "git") {
    return activeProjectId ? gitPanel : noProject;
  }
  if (page === "settings") {
    return settingsPanel;
  }
  if (page === "plugins") {
    return (
      <LazyPluginMarketplaceSurface
        settings={settings}
        onPageChange={onPageChange}
        onOpenAgentTerminal={onOpenAgentRuntimeTerminal}
        t={t}
      />
    );
  }
  if (page === "submission") {
    return activeProjectId ? (
      <LazySubmissionCiWorkspaceSurface
        shell={shell}
        selectedIsDraw={selectedIsDraw}
        selectedIsExcel={selectedIsExcel}
        compileAssistDiagnostics={compileAssistDiagnostics}
        onOpenTexMode={onOpenTexMode}
      />
    ) : noProject;
  }
  return undefined;
}
