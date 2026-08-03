import type { ReactNode } from "react";
import type { CodeLanguageInfo } from "../../../shared/utils/codeLanguage";
import { LatexWorkspaceEditorPanel } from "../editor/LatexWorkspaceEditorPanel";
import type { AgentTerminalLaunchRequest } from "../terminal/terminalTypes";
import type { AppWorkspaceShellProps } from "./workspaceShellTypes";
import { WorkspaceOnboardingChecklist } from "./WorkspaceOnboardingChecklist";

export function WorkspaceLatexEditorSurface(props: {
  shell: AppWorkspaceShellProps;
  selectedIsDraw: boolean;
  selectedIsExcel: boolean;
  selectedCodeLanguage: CodeLanguageInfo;
  scientificPluginIds: string[];
  showChatWorkspace: boolean;
  chatTabOpen: boolean;
  chatTabTitle: string | null;
  showCompileAssist: boolean;
  compileAssistDiagnostics: string[];
  compileAssistHint: string;
  compileAssistAutoFixBusy: boolean;
  terminalVisible: boolean;
  terminalLaunchRequest: AgentTerminalLaunchRequest | null;
  modeSwitcher: ReactNode;
  onTerminalToggle: () => void;
  onTerminalLaunchHandled: (requestId: number) => void;
  onCreateChatTab: () => void;
  onOpenChatTab: () => void;
  onChatTabTitleChange: (value: string | null) => void;
  onCompileClick: () => void;
  onCompileAssistDismiss: () => void;
  onCompileAssistAutoFix: () => void;
  onSelectEditorTab: (tabId: string) => void;
  onCloseChatTab: () => void;
  onActivateChatTab: () => void;
  onChatReviewRequest: (prompt: string) => void;
}) {
  const { shell } = props;
  if (!shell.activeProjectId) {
    return null;
  }

  return (
    <div className="relative h-full min-h-0">
      <LatexWorkspaceEditorPanel
        {...shell}
        suspended={Boolean(shell.suspended)}
        selectedIsDraw={props.selectedIsDraw}
        selectedIsExcel={props.selectedIsExcel}
        selectedCodeLanguage={props.selectedCodeLanguage}
        scientificPluginIds={props.scientificPluginIds}
        channelPrefs={shell.channelPrefs ?? null}
        showChatWorkspace={props.showChatWorkspace}
        chatTabOpen={props.chatTabOpen}
        chatTabTitle={props.chatTabTitle}
        showCompileAssist={props.showCompileAssist}
        compileAssistDiagnostics={props.compileAssistDiagnostics}
        compileAssistHint={props.compileAssistHint}
        compileAssistAutoFixBusy={props.compileAssistAutoFixBusy}
        terminalVisible={props.terminalVisible}
        terminalLaunchRequest={props.terminalLaunchRequest}
        terminalLayout={shell.latexTerminalLayout}
        modeSwitcher={props.modeSwitcher}
        onTerminalLayoutChange={(layout) => shell.onSavePanelLayout("latexTerminal", layout)}
        onTerminalToggle={props.onTerminalToggle}
        onTerminalLaunchHandled={props.onTerminalLaunchHandled}
        onCreateChatTab={props.onCreateChatTab}
        onOpenChatTab={props.onOpenChatTab}
        onChatTabTitleChange={props.onChatTabTitleChange}
        onCompileClick={props.onCompileClick}
        onCompileAssistDismiss={props.onCompileAssistDismiss}
        onCompileAssistAutoFix={props.onCompileAssistAutoFix}
        onSelectEditorTab={props.onSelectEditorTab}
        onCloseChatTab={props.onCloseChatTab}
        onActivateChatTab={props.onActivateChatTab}
        onChatReviewRequest={props.onChatReviewRequest}
      />
      <WorkspaceOnboardingChecklist
        activeProjectId={shell.activeProjectId}
        onboarding={shell.settings?.uiPrefs?.onboarding}
        onDismiss={shell.onOnboardingDismiss}
        t={shell.t}
      />
    </div>
  );
}
