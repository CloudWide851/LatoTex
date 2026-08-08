import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { AgentProposalMiniBar } from "./AgentProposalMiniBar";
import { EditorTabsBar } from "./EditorTabsBar";
import { getEditorSurfaceThemeName } from "./editorSurfaceTheme";
import { createWorkspaceEditorMonacoOptions } from "./editorMonacoOptions";
import { useWorkspaceEditorShareEditAnnotations } from "./useWorkspaceEditorShareEditAnnotations";
import { useWorkspaceEditorShareComments } from "./useWorkspaceEditorShareComments";
import { ChatTopbarSessionControl } from "../chat/ChatTopbarSessionControl";
import type { CodeLanguageInfo } from "../../../shared/utils/codeLanguage";
import type { AgentPhase } from "../AgentChatOverlay";
import { WorkspaceShareControl } from "../workspace/WorkspaceShareControl";
import { buildAgentCommandItems } from "../workspace/workspaceShellUtils";
import { emitWorkspaceLayoutRefresh, WORKSPACE_LAYOUT_REFRESH_EVENT, type WorkspaceLayoutRefreshDetail } from "../../hooks/workspaceLayoutRefresh";
import type { ShareConflict, ShareConflictResolution } from "../../hooks/shareSessionUtils";
import type { ShareEditAnnotation } from "../../hooks/shareEditAnnotations";
import type { AgentTeamMode, ShareCommentItem } from "../../../shared/types/app";
import {
  LazyAgentChatOverlay,
  LazyChatWorkspace,
  WorkspacePanelFallback,
} from "../workspace/workspaceShellLazy";
import { WorkspaceTerminalPanel } from "../terminal/WorkspaceTerminalPanel";
import type { AgentTerminalLaunchRequest } from "../terminal/terminalTypes";
import { markFirstEditableTex } from "./editorStartupPerformance";
import type { AgentResourceLock } from "../../../shared/types/researchAgent";
import { AgentEditorLockBanner } from "./AgentEditorLockBanner";
import { LatexEditorToolbarActions } from "./LatexEditorToolbarActions";

type TranslationFn = (key: any) => string;
const MONACO_OVERFLOW_WIDGET_ROOT_ID = "latotex-monaco-overflow-root";
const LazyWorkspaceMonacoEditor = lazy(async () => {
  const module = await import("./WorkspaceMonacoEditor");
  return { default: module.WorkspaceMonacoEditor };
});

function ensureMonacoOverflowWidgetRoot(): HTMLElement | null {
  if (typeof document === "undefined") {
    return null;
  }
  const existing = document.getElementById(MONACO_OVERFLOW_WIDGET_ROOT_ID);
  if (existing) {
    return existing;
  }
  const root = document.createElement("div");
  root.id = MONACO_OVERFLOW_WIDGET_ROOT_ID;
  root.className = "latotex-monaco-overflow-root";
  document.body.appendChild(root);
  return root;
}

export function LatexWorkspaceEditorPanel(props: {
  activeProjectId: string | null;
  busy: boolean;
  compileBusy: boolean;
  suspended: boolean;
  selectedFile: string | null;
  selectedIsDraw: boolean;
  selectedIsExcel: boolean;
  selectedCodeLanguage: CodeLanguageInfo;
  scientificPluginIds: string[];
  selectedFileWriteLock: AgentResourceLock | null;
  editorContent: string;
  fileList: string[];
  editorTabs: any[];
  activeTabId: string | null;
  dirtyByPath: Record<string, boolean>;
  shareSession: any;
  sharePassword: string | null;
  shareBusy: boolean;
  shareSyncing: boolean;
  shareConflict: ShareConflict | null;
  shareMode: any;
  shareSessionName: string;
  shareComments: ShareCommentItem[];
  shareEditAnnotations: ShareEditAnnotation[];
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
  terminalVisible: boolean;
  terminalLaunchRequest: AgentTerminalLaunchRequest | null;
  terminalLayout: number[];
  fontScale: number;
  modeSwitcher?: React.ReactNode;
  onTerminalLayoutChange: (layout: number[]) => void;
  onTerminalToggle: () => void;
  onTerminalLaunchHandled: (requestId: number) => void;
  onShareModeChange: (mode: any) => void;
  onShareSessionNameChange: (name: string) => void;
  onShareStart: () => void;
  onShareStop: () => void;
  onShareRefresh: () => void;
  onSharePasswordReveal: () => Promise<string>;
  onShareConflictResolve: (resolution: ShareConflictResolution) => void;
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
  onAgentRun: (promptOverride?: string, options?: { forceNewSession?: boolean; teamMode?: AgentTeamMode }) => void;
  onAgentSessionPickerOpenChange: (open: boolean) => void;
  onAgentSessionPickerIndexChange: (index: number) => void;
  onAgentSessionConfirm: () => void;
  onAgentRollback: () => void;
  onAgentPendingActionResolve: (accept: boolean) => void;
  chatAgentModelId: string | null;
  t: TranslationFn;
}) {
  const {
    activeProjectId,
    busy,
    compileBusy,
    suspended,
    selectedFile,
    selectedIsDraw,
    selectedIsExcel,
    selectedCodeLanguage,
    scientificPluginIds,
    selectedFileWriteLock,
    editorContent,
    fileList,
    editorTabs,
    activeTabId,
    dirtyByPath,
    shareSession,
    sharePassword,
    shareBusy,
    shareSyncing,
    shareConflict,
    shareMode,
    shareSessionName,
    shareComments,
    shareEditAnnotations,
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
    terminalVisible,
    terminalLaunchRequest,
    terminalLayout,
    fontScale,
    modeSwitcher,
    onTerminalLayoutChange,
    onTerminalToggle,
    onTerminalLaunchHandled,
    onShareModeChange,
    onShareSessionNameChange,
    onShareStart,
    onShareStop,
    onShareRefresh,
    onSharePasswordReveal,
    onShareConflictResolve,
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
    chatAgentModelId,
    t,
  } = props;
  const [editorTheme, setEditorTheme] = useState(getEditorSurfaceThemeName);
  const [monacoOverflowWidgetRoot, setMonacoOverflowWidgetRoot] = useState<HTMLElement | null>(() => ensureMonacoOverflowWidgetRoot());
  const editorInstanceRef = useRef<any | null>(null);
  const agentCommandItems = buildAgentCommandItems(t);
  const editorLanguage = selectedCodeLanguage.monaco;
  const editorOptions = useMemo(
    () => createWorkspaceEditorMonacoOptions(
      monacoOverflowWidgetRoot,
      fontScale,
      Boolean(selectedFileWriteLock),
    ),
    [fontScale, monacoOverflowWidgetRoot, selectedFileWriteLock],
  );

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

  useEffect(() => {
    setMonacoOverflowWidgetRoot(ensureMonacoOverflowWidgetRoot());
  }, []);

  useWorkspaceEditorShareComments({
    editor: showChatWorkspace || selectedIsExcel ? null : editorInstanceRef.current,
    selectedFile,
    shareSession,
    shareComments,
    t,
  });

  useWorkspaceEditorShareEditAnnotations({
    editor: showChatWorkspace || selectedIsExcel ? null : editorInstanceRef.current,
    selectedFile,
    shareSession,
    annotations: shareEditAnnotations,
    t,
  });

  useEffect(() => {
    const editor = editorInstanceRef.current;
    if (!editor || showChatWorkspace || selectedIsExcel) {
      return;
    }
    editor.updateOptions(editorOptions);
    editor.layout();
  }, [editorLanguage, editorOptions, editorTheme, selectedFile, selectedIsExcel, showChatWorkspace]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handleLayoutRefresh = (event: Event) => {
      const detail = (event as CustomEvent<WorkspaceLayoutRefreshDetail>).detail;
      if (!detail || detail.page !== "latex") {
        return;
      }
      window.requestAnimationFrame(() => {
        const editor = editorInstanceRef.current;
        editor?.layout();
        editor?.render?.(true);
      });
    };
    window.addEventListener(WORKSPACE_LAYOUT_REFRESH_EVENT, handleLayoutRefresh as EventListener);
    return () => {
      window.removeEventListener(WORKSPACE_LAYOUT_REFRESH_EVENT, handleLayoutRefresh as EventListener);
    };
  }, []);

  const editorStageContent = (
    <>
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
            selectedFile={selectedFile}
            channelPrefs={channelPrefs}
            suspended={suspended}
            chatAgentModelId={chatAgentModelId}
            agentPhase={agentPhase}
            agentRunId={agentRunId}
            agentMessages={agentMessages}
            agentProposal={agentProposal}
            agentPendingAction={agentPendingAction}
            events={events}
            onRunWorkspaceAgent={onAgentRun}
            onAcceptWorkspaceAgentProposal={onAgentAcceptProposal}
            onRejectWorkspaceAgentProposal={onAgentRejectProposal}
            onResolveWorkspaceAgentPendingAction={onAgentPendingActionResolve}
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
        <div className="relative h-full min-h-0">
          <AgentEditorLockBanner
            lock={selectedFileWriteLock}
            title={t("research.agent.resourceLocked")}
            description={t("research.agent.editorReadOnly")}
          />
          <Suspense fallback={<WorkspacePanelFallback label={t("common.loading")} />}>
            <LazyWorkspaceMonacoEditor
              projectId={activeProjectId ?? ""}
              path={selectedFile ?? undefined}
              language={editorLanguage}
              theme={editorTheme}
              value={editorContent}
              options={editorOptions}
              editorInstanceRef={editorInstanceRef}
              onChange={onEditorChange}
              onMount={(editor, monaco) => {
                markFirstEditableTex(selectedFile);
                onEditorMount(editor, monaco);
              }}
            />
          </Suspense>
        </div>
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
            onRunTeams={() => onAgentRun(undefined, { teamMode: "force" })}
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
    </>
  );

  return (
    <div className="editor-workspace-shell grid h-full min-w-0 grid-rows-[auto_34px_minmax(260px,1fr)] overflow-hidden rounded-lg motion-shell-stage">
      <div className="editor-toolbar-shell min-w-0 overflow-visible px-3 py-2">
        <div className="panel-topbar grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          <div className="editor-toolbar-surface-group flex min-w-0 items-center gap-2 overflow-visible">
            {modeSwitcher ? (
              <div className="shrink-0">{modeSwitcher}</div>
            ) : null}
            <WorkspaceShareControl
              selectedFile={selectedFile}
              shareSession={shareSession}
              sharePassword={sharePassword}
              shareBusy={shareBusy}
              shareSyncing={shareSyncing}
              shareConflict={shareConflict}
              shareMode={shareMode}
              shareSessionName={shareSessionName}
              onShareModeChange={onShareModeChange}
              onShareSessionNameChange={onShareSessionNameChange}
              onShareStart={onShareStart}
              onShareStop={onShareStop}
              onShareRefresh={onShareRefresh}
              onSharePasswordReveal={onSharePasswordReveal}
              onShareConflictResolve={onShareConflictResolve}
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
          <LatexEditorToolbarActions
            activeProjectId={activeProjectId}
            busy={busy}
            compileBusy={compileBusy}
            selectedFile={selectedFile}
            selectedIsDraw={selectedIsDraw}
            selectedFileWriteLocked={Boolean(selectedFileWriteLock)}
            editorContent={editorContent}
            scientificPluginIds={scientificPluginIds}
            terminalVisible={terminalVisible}
            showCompileAssist={showCompileAssist}
            compileAssistDiagnostics={compileAssistDiagnostics}
            compileAssistHint={compileAssistHint}
            compileAssistAutoFixBusy={compileAssistAutoFixBusy}
            getSelectedCode={() => {
              const editor = editorInstanceRef.current;
              const selection = editor?.getSelection?.();
              return selection ? editor?.getModel?.()?.getValueInRange?.(selection) ?? "" : "";
            }}
            onEditorUndo={onEditorUndo}
            onEditorRedo={onEditorRedo}
            onSaveFile={onSaveFile}
            onTerminalToggle={onTerminalToggle}
            onOpenDraw={() => onPageChange("draw")}
            onCompileClick={onCompileClick}
            onCompileAssistDismiss={onCompileAssistDismiss}
            onCompileAssistAutoFix={onCompileAssistAutoFix}
            t={t}
          />
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

      <div className="editor-content-stage h-full min-h-0">
        {terminalVisible ? (
          <PanelGroup
            direction="vertical"
            className="h-full min-h-0"
            onLayout={(layout) => {
              onTerminalLayoutChange(layout);
              editorInstanceRef.current?.layout();
              emitWorkspaceLayoutRefresh("latex", "panel-layout");
            }}
          >
            <Panel id="latex-editor-main" order={1} defaultSize={terminalLayout[0] ?? 78} minSize={42} className="min-h-0">
              <div className="relative h-full min-h-0">{editorStageContent}</div>
            </Panel>
            <PanelResizeHandle className="resizable-handle resizable-handle-vertical" />
            <Panel id="latex-editor-terminal" order={2} defaultSize={terminalLayout[1] ?? 22} minSize={10} className="min-h-0">
              <WorkspaceTerminalPanel
                activeProjectId={activeProjectId}
                selectedFile={selectedFile}
                active={terminalVisible}
                launchRequest={terminalLaunchRequest}
                onLaunchRequestHandled={onTerminalLaunchHandled}
                fontScale={fontScale}
                t={t}
              />
            </Panel>
          </PanelGroup>
        ) : (
          <div className="relative h-full min-h-0">{editorStageContent}</div>
        )}
      </div>
    </div>
  );
}
