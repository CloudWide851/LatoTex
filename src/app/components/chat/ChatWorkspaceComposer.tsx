import {
  FlaskConical,
  MessageCircle,
  Paperclip,
  Send,
  Square,
  UsersRound,
} from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { Select } from "../../../components/ui/select";
import { AgentProposalMiniBar } from "../editor/AgentProposalMiniBar";
import type { AgentFileProposal } from "../../hooks/agentTypes";
import type { AgentPendingAction } from "../../hooks/useAppContainerState";
import type { AgentPhase } from "../AgentChatOverlay";

type TranslationFn = (key: any) => string;

export function ChatWorkspaceComposer(props: {
  draft: string;
  running: boolean;
  lastError: string;
  agentPhase: AgentPhase;
  agentProposal: AgentFileProposal | null;
  agentPendingAction: AgentPendingAction | null;
  mode: "general" | "research";
  contextScope: "conversation" | "current-file";
  selectedFile?: string | null;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onSendTeams: () => void;
  onStop: () => void;
  onModeChange: (mode: "general" | "research") => void;
  onContextScopeChange: (scope: "conversation" | "current-file") => void;
  onAcceptWorkspaceAgentProposal?: (withAnalysis: boolean) => void;
  onRejectWorkspaceAgentProposal?: () => void;
  onResolveWorkspaceAgentPendingAction?: (accept: boolean) => void;
  t: TranslationFn;
}) {
  const {
    draft,
    running,
    lastError,
    agentPhase,
    agentProposal,
    agentPendingAction,
    mode,
    contextScope,
    selectedFile,
    onDraftChange,
    onSend,
    onSendTeams,
    onStop,
    onModeChange,
    onContextScopeChange,
    onAcceptWorkspaceAgentProposal,
    onRejectWorkspaceAgentProposal,
    onResolveWorkspaceAgentPendingAction,
    t,
  } = props;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.max(72, Math.min(180, textarea.scrollHeight))}px`;
  }, [draft]);

  return (
    <div className="editor-chat-paper-surface border-t px-3 pb-3 pt-2">
      {agentProposal && onAcceptWorkspaceAgentProposal && onRejectWorkspaceAgentProposal ? (
        <div className="mb-2">
          <div className="mb-1 text-[11px] font-semibold text-slate-500">{t("chat.workspaceProposalTitle")}</div>
          <AgentProposalMiniBar
            proposal={agentProposal}
            busy={running || agentPhase === "running"}
            onAccept={() => onAcceptWorkspaceAgentProposal(false)}
            onReject={onRejectWorkspaceAgentProposal}
            t={t}
          />
        </div>
      ) : null}
      {agentPendingAction?.kind === "autoCommit" && onResolveWorkspaceAgentPendingAction ? (
        <div className="app-status-warning mb-2 rounded-md border px-3 py-2 text-xs">
          <div className="font-semibold">{t("chat.workspacePendingTitle")}</div>
          <div className="mt-1">{agentPendingAction.targetPath}</div>
          <div className="mt-2 flex gap-2">
            <button
              className="control-button control-button--primary px-2 py-1"
              onClick={() => onResolveWorkspaceAgentPendingAction(true)}
            >
              {t("agent.autoCommit.yes")}
            </button>
            <button
              className="control-button control-button--secondary px-2 py-1"
              onClick={() => onResolveWorkspaceAgentPendingAction(false)}
            >
              {t("agent.autoCommit.no")}
            </button>
          </div>
        </div>
      ) : null}
      <div className="app-material-inset overflow-hidden rounded-xl border focus-within:border-[color:var(--app-accent)]">
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (!running && draft.trim()) onSend();
            }
          }}
          placeholder={t("chat.inputPlaceholder")}
          rows={3}
          className="editor-chat-input hide-scrollbar block w-full resize-none overflow-auto bg-transparent px-3 pb-2 pt-3 text-sm leading-5 text-[color:var(--app-fg)] outline-none"
        />
        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-2 py-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <div className="inline-flex rounded-md border p-0.5" role="group" aria-label={t("chat.modeLabel")}>
              <button
                type="button"
                className={`inline-flex h-7 items-center gap-1 rounded px-2 text-[10px] font-medium ${mode === "general" ? "bg-[color:var(--editor-widget-bg)] text-[color:var(--app-fg)] shadow-sm" : "text-[color:var(--app-muted)]"}`}
                aria-pressed={mode === "general"}
                onClick={() => onModeChange("general")}
              >
                <MessageCircle className="h-3 w-3" />
                {t("chat.modeGeneral")}
              </button>
              <button
                type="button"
                className={`inline-flex h-7 items-center gap-1 rounded px-2 text-[10px] font-medium ${mode === "research" ? "bg-[color:var(--editor-widget-bg)] text-[color:var(--app-fg)] shadow-sm" : "text-[color:var(--app-muted)]"}`}
                aria-pressed={mode === "research"}
                onClick={() => onModeChange("research")}
              >
                <FlaskConical className="h-3 w-3" />
                {t("chat.modeResearch")}
              </button>
            </div>
            <Select
              value={contextScope}
              onChange={(event) => onContextScopeChange(event.target.value as "conversation" | "current-file")}
              aria-label={t("chat.contextLabel")}
              className="h-8 min-w-32 text-[10px]"
            >
              <option value="conversation">{t("chat.contextConversation")}</option>
              <option value="current-file" disabled={!selectedFile}>{t("chat.contextCurrentFile")}</option>
            </Select>
            <button
              type="button"
              className={`panel-topbar-btn inline-flex h-8 w-8 items-center justify-center rounded-md border ${contextScope === "current-file" ? "text-[color:var(--app-accent)]" : ""}`}
              disabled={!selectedFile}
              onClick={() => onContextScopeChange(contextScope === "current-file" ? "conversation" : "current-file")}
              title={contextScope === "current-file" ? t("chat.detachCurrentFile") : t("chat.attachCurrentFile")}
              aria-label={contextScope === "current-file" ? t("chat.detachCurrentFile") : t("chat.attachCurrentFile")}
            >
              <Paperclip className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="hidden text-[9px] text-[color:var(--app-muted)] 2xl:inline">{t("chat.shortcutHint")}</span>
          {!running ? (
            <button
              className="panel-topbar-btn inline-flex h-8 w-8 items-center justify-center rounded-full border transition disabled:opacity-40"
              onClick={onSendTeams}
              disabled={!draft.trim()}
              title={t("agent.teams.run")}
              aria-label={t("agent.teams.run")}
            >
              <UsersRound className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <button
            className={`inline-flex h-8 w-8 items-center justify-center rounded-full border transition ${
              running
                ? "border-amber-400 bg-amber-50 text-amber-700 hover:bg-amber-100"
                : "border-primary-600 bg-primary-600 text-white hover:bg-primary-700"
            }`}
            onClick={running ? onStop : onSend}
            disabled={!running && !draft.trim()}
            title={running ? t("agent.run.cancel") : t("chat.send")}
            aria-label={running ? t("agent.run.cancel") : t("chat.send")}
          >
            {running ? <Square className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
          </button>
          </div>
        </div>
      </div>
      {lastError ? <div className="app-status-danger mt-2 rounded border px-2 py-1.5 text-[11px]" role="alert">{lastError}</div> : null}
    </div>
  );
}
