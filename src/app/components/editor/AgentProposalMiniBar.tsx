import { Check, X } from "lucide-react";
import type { AgentFileProposal } from "../../hooks/agentTypes";

type TranslationFn = (key: any) => string;

export function AgentProposalMiniBar(props: {
  proposal: AgentFileProposal;
  busy: boolean;
  onAccept: () => void;
  onReject: () => void;
  t: TranslationFn;
}) {
  const { proposal, busy, onAccept, onReject, t } = props;
  return (
    <div className="pointer-events-auto absolute right-3 top-2 z-40 inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50/95 px-1.5 py-1 shadow-soft">
      <span className="text-[10px] font-semibold text-amber-900">
        {t("agent.proposalMini.delta")
          .replace("{plus}", String(proposal.insertions ?? 0))
          .replace("{minus}", String(proposal.deletions ?? 0))}
      </span>
      <button
        className="inline-flex h-5 w-5 items-center justify-center rounded border border-emerald-600 bg-emerald-600 text-white transition hover:bg-emerald-700 disabled:opacity-40"
        onClick={onAccept}
        disabled={busy}
        title={t("agent.proposalMini.apply")}
        aria-label={t("agent.proposalMini.apply")}
      >
        <Check className="h-3.5 w-3.5" />
      </button>
      <button
        className="inline-flex h-5 w-5 items-center justify-center rounded border border-rose-600 bg-rose-600 text-white transition hover:bg-rose-700 disabled:opacity-40"
        onClick={onReject}
        disabled={busy}
        title={t("agent.proposalMini.reject")}
        aria-label={t("agent.proposalMini.reject")}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
