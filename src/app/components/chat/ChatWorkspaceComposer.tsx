import { Send, Square } from "lucide-react";
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
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
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
    onDraftChange,
    onSend,
    onStop,
    onAcceptWorkspaceAgentProposal,
    onRejectWorkspaceAgentProposal,
    onResolveWorkspaceAgentPendingAction,
    t,
  } = props;

  return (
    <div className="editor-chat-paper-surface flex h-full min-h-0 flex-col border-t px-2 pb-2 pt-1.5">
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
        <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <div className="font-semibold">{t("chat.workspacePendingTitle")}</div>
          <div className="mt-1">{agentPendingAction.targetPath}</div>
          <div className="mt-2 flex gap-2">
            <button
              className="rounded border border-emerald-600 bg-emerald-600 px-2 py-1 text-white"
              onClick={() => onResolveWorkspaceAgentPendingAction(true)}
            >
              {t("agent.autoCommit.yes")}
            </button>
            <button
              className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700"
              onClick={() => onResolveWorkspaceAgentPendingAction(false)}
            >
              {t("agent.autoCommit.no")}
            </button>
          </div>
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1">
        <textarea
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder={t("chat.inputPlaceholder")}
          className="editor-chat-input h-full w-full resize-none rounded-md border px-3 py-2 pr-12 text-sm leading-5 outline-none focus:border-primary-500"
        />
        <button
          className={`absolute bottom-2 right-2 inline-flex h-8 w-8 items-center justify-center rounded-full border transition ${
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
      {lastError ? <div className="mt-1 truncate text-[11px] text-rose-600">{lastError}</div> : null}
    </div>
  );
}
