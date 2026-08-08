import { LockKeyhole } from "lucide-react";
import type { AgentResourceLock } from "../../../shared/types/researchAgent";

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
      className="app-status-warning pointer-events-none absolute left-3 top-3 z-20 flex max-w-[min(28rem,calc(100%-1.5rem))] items-start gap-2 rounded-md border px-2.5 py-2 text-xs shadow-sm"
      role="status"
      data-agent-editor-lock="true"
    >
      <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>
        <span className="block font-medium">{props.title}</span>
        <span className="mt-0.5 block opacity-80">{props.description}</span>
      </span>
    </div>
  );
}
