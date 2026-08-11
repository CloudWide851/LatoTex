import { LockKeyhole } from "lucide-react";
import type { AgentResourceLock } from "../../../shared/types/researchAgent";
import { InfoHint } from "../../../components/ui/info-hint";

export function AgentEditorLockBanner(props: {
  lock: AgentResourceLock | null;
  title: string;
  description: string;
}) {
  if (!props.lock) {
    return null;
  }
  return (
    <div
      className="app-status-warning absolute left-3 top-3 z-20 flex max-w-[min(28rem,calc(100%-1.5rem))] items-center gap-2 rounded-md border px-2.5 py-2 text-xs shadow-sm"
      role="status"
      data-agent-editor-lock="true"
    >
      <LockKeyhole className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="font-medium">{props.title}</span>
      <InfoHint content={props.description} label={props.title} tone="warning" />
    </div>
  );
}
