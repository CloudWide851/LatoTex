import { LockKeyhole } from "lucide-react";

export function ExplorerAgentLock(props: { locked: boolean; label: string }) {
  if (!props.locked) {
    return null;
  }
  return (
    <span title={props.label} aria-label={props.label} data-agent-resource-lock="true">
      <LockKeyhole className="h-3 w-3 shrink-0 text-[color:var(--app-accent)]" aria-hidden="true" />
    </span>
  );
}
