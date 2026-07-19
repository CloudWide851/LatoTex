import { ShieldAlert } from "lucide-react";
import { useState } from "react";
import { Button } from "../../../components/ui/button";
import { resolveAgentApproval } from "../../../shared/api/agent";
import type { AgentApprovalDecision } from "../../../shared/types/app";
import type { AgentEventCard } from "../../hooks/analysisWorkspaceHelpers";

function capabilityLabel(
  capability: { capability: string; resource: string },
  t: (key: any) => string,
) {
  const key = `agent.approval.capability.${capability.capability}`;
  const label = t(key as any);
  const resource = capability.resource.trim();
  return resource && !["web", "workspace", "managed"].includes(resource)
    ? `${label} · ${resource}`
    : label;
}

export function AgentApprovalCard(props: {
  card: AgentEventCard;
  t: (key: any) => string;
}) {
  const { card, t } = props;
  const [busyDecision, setBusyDecision] = useState<AgentApprovalDecision | null>(null);
  const [resolved, setResolved] = useState(false);
  const [error, setError] = useState("");
  const isPending = card.requiresApproval && card.approvalId && !resolved;
  if (!isPending) {
    return null;
  }

  const resolve = async (decision: AgentApprovalDecision) => {
    setBusyDecision(decision);
    setError("");
    try {
      await resolveAgentApproval(card.approvalId!, decision);
      setResolved(true);
    } catch (nextError) {
      setError(String(nextError ?? t("agent.approval.error")));
    } finally {
      setBusyDecision(null);
    }
  };
  const expiresAt = card.approvalExpiresAt
    ? new Date(card.approvalExpiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";

  return (
    <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-amber-950" role="alert">
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{t("agent.approval.title")}</div>
          <p className="mt-0.5 text-[11px] leading-4 text-amber-900">
            {t("agent.approval.description")}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {(card.approvalCapabilities ?? []).map((capability) => (
              <span
                key={`${capability.capability}:${capability.resource}`}
                className="rounded-full border border-amber-300 bg-white/80 px-2 py-0.5 text-[10px] font-medium"
              >
                {capabilityLabel(capability, t)}
              </span>
            ))}
          </div>
          {expiresAt ? (
            <p className="mt-1.5 text-[10px] text-amber-700">
              {t("agent.approval.expiresAt").replace("{time}", expiresAt)}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button
              type="button"
              size="sm"
              onClick={() => void resolve("allow_once")}
              disabled={busyDecision !== null}
            >
              {busyDecision === "allow_once" ? t("agent.approval.resolving") : t("agent.approval.allowOnce")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => void resolve("allow_project")}
              disabled={busyDecision !== null}
            >
              {busyDecision === "allow_project" ? t("agent.approval.resolving") : t("agent.approval.allowProject")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="danger"
              onClick={() => void resolve("deny")}
              disabled={busyDecision !== null}
            >
              {busyDecision === "deny" ? t("agent.approval.resolving") : t("agent.approval.deny")}
            </Button>
          </div>
          {error ? <p className="mt-2 break-words text-[11px] text-rose-700" aria-live="polite">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}
