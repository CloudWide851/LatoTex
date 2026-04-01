import { Suspense, useEffect, useState } from "react";
import MonacoEditor from "@monaco-editor/react";
import { PenTool, Play, Redo2, Save, Undo2 } from "lucide-react";
import { AgentProposalMiniBar } from "./AgentProposalMiniBar";
import { CompileAssistPopover } from "./CompileAssistPopover";
import { EditorTabsBar } from "./EditorTabsBar";
import { getEditorSurfaceThemeName, registerEditorSurfaceThemes } from "./editorSurfaceTheme";
import { registerEditorCodeLanguages } from "./editorCodeLanguages";
import { ensureLatexCompletionProvider } from "./latexCompletion";
import { ChatTopbarSessionControl } from "../chat/ChatTopbarSessionControl";
import { resolveCodeLanguage } from "../../../shared/utils/codeLanguage";
import type { AgentPhase } from "../AgentChatOverlay";
import { WorkspaceShareControl } from "../workspace/WorkspaceShareControl";
import { buildAgentCommandItems, composeTitleWithShortcut } from "../workspace/workspaceShellUtils";
import {
  LazyAgentChatOverlay,
  LazyChatWorkspace,
  WorkspacePanelFallback,
} from "../workspace/workspaceShellLazy";

type TranslationFn = (key: any) => string;

export function LatexWorkspaceEditorPanel(props: {
  activeProjectId: string | null;
  busy: boolean;
  suspended: boolean;
  selectedFile: string | null;
  selectedIsDraw: boolean;
  selectedIsExcel: boolean;
  editorContent: string;
  editorTabs: any[];
  activeTabId: string | null;
  dirtyByPath: Record<string, boolean>;
  shareSession: any;
  shareBusy: boolean;
  shareSyncing: boolean;
  shareMode: any;
  shareSessionName: string;
  channelPrefs: any;
  agentCollapsed: boolean;
  agentPhase: AgentPhase;
  agentStatusKey: any;
  agentPrompt: string;
  agentMessages: any[];
  agentProposal: any;
  agentPendingAction: any;
  agentRunId: string | null;
  agentSessions: any[];
  agentSessionPickerOpen: boolean;
  agentSessionPickerIndex: number;
  agentRollbackVisible: boolean;
  events: any[];
  showChatWorkspace: boolean;
  chatTabOpen: boolean;
  chatTabTitle: string | null;
  showCompileAssist: boolean;
  compileAssistDiagnostics: string[];
  compileAssistHint: string;
  compileAssistAutoFixBusy: boolean;
  onShareModeChange: (mode: any) => void;
  onShareSessionNameChange: (name: string) => void;
  onShareStart: () => void;
  onShareStop: () => void;
  onShareRefresh: () => void;
  onCreateChatTab: () => void;
  onOpenChatTab: () => void;
  onChatTabTitleChange: (value: string | null) => void;
  onEditorUndo: () => void;
  onEditorRedo: () => void;
  onSaveFile: () => void;
  onPageChange: (page: any) => void;
  onCompileClick: () => void;
  onCompileAssistDismiss: () => void;
  onCompileAssistAutoFix: () => void;
  onSelectEditorTab: (tabId: string) => void;
  onCloseChatTab: () => void;
  onActivateChatTab: () => void;
  onTabClose: (tabId: string) => void;
  onTabCloseAction: (action: any, tabId: string) => void;
  onTabPin: (tabId: string) => void;
  onAgentAcceptProposal: (withAnalysis: boolean) => void;
  onAgentRejectProposal: () => void;
  onAgentToggle: () => void;
  onChatReviewRequest: (prompt: string) => void;
  onEditorChange: (value: string) => void;
  onEditorMount: (editor: any, monaco: any) => void;
  onAgentPromptChange: (value: string) => void;
  onAgentRun: (promptOverride?: string, options?: { forceNewSession?: boolean }) => void;
  onAgentSessionPickerOpenChange: (open: boolean) => void;
  onAgentSessionPickerIndexChange: (index: number) => void;
  onAgentSessionConfirm: () => void;
  onAgentRollback: () => void;
  onAgentPendingActionResolve: (accept: boolean) => void;
  t: TranslationFn;
}) {
  const {
    activeProjectId,
    busy,
    suspended,
    selectedFile,
    selectedIsDraw,
    selectedIsExcel,
    editorContent,
    editorTabs,
    activeTabId,
    dirtyByPath,
    shareSession,
    shareBusy,
    shareSyncing,
    shareMode,
    shareSessionName,
    channelPrefs,
    agentCollapsed,
    agentPhase,
    agentStatusKey,
    agentPrompt,
    agentMessages,
    agentProposal,
    agentPendingAction,
    agentRunId,
    agentSessions,
    agentSessionPickerOpen,
    agentSessionPickerIndex,
    agentRollbackVisible,
    events,
    showChatWorkspace,
    chatTabOpen,
    chatTabTitle,
    showCompileAssist,
    compileAssistDiagnostics,
    compileAssistHint,
    compileAssistAutoFixBusy,
    onShareModeChange,
    onShareSessionNameChange,
    onShareStart,
    onShareStop,
    onShareRefresh,
    onCreateChatTab,
    onOpenChatTab,
    onChatTabTitleChange,
    onEditorUndo,
    onEditorRedo,
    onSaveFile,
    onPageChange,
    onCompileClick,
    onCompileAssistDismiss,
    onCompileAssistAutoFix,
    onSelectEditorTab,
    onCloseChatTab,
    onActivateChatTab,
    onTabClose,
    onTabCloseAction,
    onTabPin,
    onAgentAcceptProposal,
    onAgentRejectProposal,
    onAgentToggle,
    onChatReviewRequest,
    onEditorChange,
    onEditorMount,
    onAgentPromptChange,
    onAgentRun,
    onAgentSessionPickerOpenChange,
    onAgentSessionPickerIndexChange,
    onAgentSessionConfirm,
    onAgentRollback,
    onAgentPendingActionResolve,
    t,
  } = props;
  const [editorTheme, setEditorTheme] = useState(getEditorSurfaceThemeName);
  const agentCommandItems = buildAgentCommandItems(t);
  const editorLanguage = resolveCodeLanguage(selectedFile).monaco;

  useEffect(() => {
    if (typeof document === "undefined" || typeof MutationObserver === "undefined") {
      return;
    }
    const root = document.documentElement;
    const syncTheme = () => setEditorTheme(getEditorSurfaceThemeName());
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return (
    <div className="editor-workspace-shell grid h-full min-w-0 grid-rows-[auto_34px_minmax(260px,1fr)] overflow-hidden rounded-lg motion-shell-stage">
      <div className="editor-toolbar-shell min-w-0 overflow-visible px-3 py-2">
        <div className="panel-topbar flex w-full min-w-0 items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-visible">
            <WorkspaceShareControl
              selectedFile={selectedFile}
              shareSession={shareSession}
              shareBusy={shareBusy}
              shareSyncing={shareSyncing}
              shareMode={shareMode}
              shareSessionName={shareSessionName}
              onShareModeChange={onShareModeChange}
              onShareSessionNameChange={onShareSessionNameChange}
              onShareStart={onShareStart}
              onShareStop={onShareStop}
              onShareRefresh={onShareRefresh}
              t={t}
            />
            <ChatTopbarSessionControl
              activeProjectId={activeProjectId}
              onCreateChatTab={onCreateChatTab}
              onOpenChatTab={onOpenChatTab}
              onSessionStateChanged={onChatTabTitleChange}
              t={t}
            />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              className="panel-topbar-btn editor-toolbar-btn motion-hover-rise disabled:opacity-50"
              onClick={onEditorUndo}
              disabled={busy}
              title={composeTitleWithShortcut(t("workspace.undo"), t("shortcut.undo"))}
              aria-label={composeTitleWithShortcut(t("workspace.undo"), t("shortcut.undo"))}
            >
              <Undo2 className="h-4 w-4" />
            </button>
            <button
              className="panel-topbar-btn editor-toolbar-btn motion-hover-rise disabled:opacity-50"
              onClick={onEditorRedo}
              disabled={busy}
              title={composeTitleWithShortcut(t("workspace.redo"), t("shortcut.redo"))}
              aria-label={composeTitleWithShortcut(t("workspace.redo"), t("shortcut.redo"))}
            >
              <Redo2 className="h-4 w-4" />
            </button>
            <button
              className="panel-topbar-btn editor-toolbar-btn motion-hover-rise disabled:opacity-50"
              onClick={onSaveFile}
              disabled={busy}
              title={composeTitleWithShortcut(t("workspace.save"), t("shortcut.save"))}
              aria-label={composeTitleWithShortcut(t("workspace.save"), t("shortcut.save"))}
            >
              <Save className="h-4 w-4" />
            </button>
            <div className="relative">
              {selectedIsDraw ? (
                <button
                  className="panel-topbar-btn editor-toolbar-btn motion-hover-rise disabled:opacity-50"
                  onClick={() => onPageChange("draw")}
                  disabled={busy}
                  title={t("workspace.openDrawPage")}
                  aria-label={t("workspace.openDrawPage")}
                >
                  <PenTool className="h-4 w-4" />
                </button>
              ) : null}
              <button
                className="panel-topbar-btn editor-toolbar-btn editor-toolbar-btn--primary motion-hover-rise disabled:opacity-50"
                onClick={onCompileClick}
                disabled={busy}
                title={composeTitleWithShortcut(t("workspace.compile"), t("shortcut.compile"))}
                aria-label={composeTitleWithShortcut(t("workspace.compile"), t("shortcut.compile"))}
              >
                <Play className="h-4 w-4" />
              </button>
              <CompileAssistPopover
                visible={showCompileAssist}
                diagnostics={compileAssistDiagnostics}
                hint={compileAssistHint}
                onDismiss={onCompileAssistDismiss}
                onAutoFix={() => {
                  void onCompileAssistAutoFix();
                }}
                autoFixDisabled={busy || compileAssistAutoFixBusy}
                t={t}
              />
            </div>
          </div>
        </div>
      </div>

      <EditorTabsBar
        tabs={editorTabs}
        activeTabId={showChatWorkspace ? null : activeTabId}
        dirtyByPath={dirtyByPath}
        busy={busy}
        extraTabs={chatTabOpen ? [{
          id: "editor-chat-tab",
          title: chatTabTitle?.trim() ? chatTabTitle : t("nav.chat"),
          active: showChatWorkspace,
          onSelect: onActivateChatTab,
          onClose: onCloseChatTab,
        }] : []}
        onSelect={onSelectEditorTab}
        onClose={onTabClose}
        onCloseAction={onTabCloseAction}
        onPin={onTabPin}
        t={t}
      />

      <div className="editor-content-stage relative h-full min-h-0">
        {agentProposal ? (
          <AgentProposalMiniBar
            proposal={agentProposal}
            busy={busy}
            onAccept={() => onAgentAcceptProposal(false)}
            onReject={onAgentRejectProposal}
            t={t}
          />
        ) : null}

        {showChatWorkspace ? (
          <Suspense fallback={<WorkspacePanelFallback label={t("common.loading")} />}>
            <LazyChatWorkspace
              projectId={activeProjectId}
              channelPrefs={channelPrefs}
              suspended={suspended}
              onRequestAgentReview={(prompt) => {
                onChatReviewRequest(prompt);
              }}
              t={t}
            />
          </Suspense>
        ) : selectedIsExcel ? (
          <div className="editor-empty-state flex h-full items-center justify-center text-xs">
            {t("editor.excelPreviewOnly")}
          </div>
        ) : (
          <MonacoEditor
            language={editorLanguage}
            theme={editorTheme}
            value={editorContent}
            beforeMount={(monaco) => {
              registerEditorSurfaceThemes(monaco);
              registerEditorCodeLanguages(monaco);
            }}
            onChange={(value) => onEditorChange(value ?? "")}
            onMount={(editor, monaco) => {
              ensureLatexCompletionProvider(monaco);
              onEditorMount(editor, monaco);
            }}
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              fontLigatures: true,
              letterSpacing: 0.15,
              lineHeight: 22,
              smoothScrolling: true,
              automaticLayout: true,
              quickSuggestions: { other: true, comments: false, strings: true },
              suggestOnTriggerCharacters: true,
              tabCompletion: "on",
              inlineSuggest: { enabled: true, mode: "subword" },
              bracketPairColorization: { enabled: true },
              acceptSuggestionOnCommitCharacter: true,
              wordWrap: "on",
              wordWrapColumn: 0,
              wrappingIndent: "same",
              padding: { top: 20, bottom: 28 },
              scrollBeyondLastLine: false,
              hideCursorInOverviewRuler: true,
              overviewRulerBorder: false,
              roundedSelection: true,
              selectionHighlight: false,
              renderLineHighlight: "line",
              renderLineHighlightOnlyWhenFocus: true,
              cursorBlinking: "smooth",
              cursorSmoothCaretAnimation: "on",
              fixedOverflowWidgets: true,
              stickyScroll: { enabled: false },
              scrollbar: {
                verticalScrollbarSize: 10,
                horizontalScrollbarSize: 10,
                alwaysConsumeMouseWheel: false,
              },
            }}
          />
        )}

        {showChatWorkspace ? null : (
          <Suspense fallback={<WorkspacePanelFallback label={t("common.loading")} />}>
            <LazyAgentChatOverlay
              collapsed={agentCollapsed}
              phase={agentPhase}
              statusLine={t(agentStatusKey)}
              title={t("agent.chatTitle")}
              collapseLabel={t("agent.collapse")}
              prompt={agentPrompt}
              busy={busy}
              messages={agentMessages}
              proposal={agentProposal}
              pendingAction={agentPendingAction}
              runId={agentRunId}
              sessions={agentSessions}
              sessionPickerOpen={agentSessionPickerOpen}
              sessionPickerIndex={agentSessionPickerIndex}
              rollbackVisible={agentRollbackVisible}
              events={events}
              onPromptChange={onAgentPromptChange}
              onRun={() => onAgentRun()}
              onSessionPickerOpenChange={onAgentSessionPickerOpenChange}
              onSessionPickerIndexChange={onAgentSessionPickerIndexChange}
              onSessionConfirm={onAgentSessionConfirm}
              onRollback={onAgentRollback}
              onToggle={onAgentToggle}
              onAcceptProposal={onAgentAcceptProposal}
              onRejectProposal={onAgentRejectProposal}
              onPendingActionResolve={onAgentPendingActionResolve}
              runLabel={agentPhase === "running" ? t("agent.run.cancel") : t("workspace.runTaskAgent")}
              placeholder={t("workspace.agentPlaceholder")}
              activityShowLabel={t("agent.activityShow")}
              activityHideLabel={t("agent.activityHide")}
              applyLabel={t("agent.proposalApply")}
              rejectLabel={t("agent.proposalReject")}
              autoAnalyzeLabel={t("agent.proposalAutoAnalyze")}
              showMoreLabel={t("agent.showMore")}
              showLessLabel={t("agent.showLess")}
              commands={agentCommandItems}
              resumeTitle={t("agent.resume.title")}
              resumeHint={t("agent.resume.hint")}
              resumeEmptyLabel={t("agent.resume.empty")}
              rollbackLabel={t("agent.rollback.restore")}
              pendingActionTitle={t("agent.autoCommit.title")}
              pendingActionDesc={t("agent.autoCommit.desc")}
              pendingActionWaitLabel={t("agent.pendingAction.waiting")}
              pendingActionYesLabel={t("agent.autoCommit.yes")}
              pendingActionNoLabel={t("agent.autoCommit.no")}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}

