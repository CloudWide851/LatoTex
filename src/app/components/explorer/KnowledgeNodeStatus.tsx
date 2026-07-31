import { LockKeyhole } from "lucide-react";
import { cn } from "../../../lib/utils";
import type { ResourceNode } from "../../../shared/types/app";

type TranslationFn = (key: any) => string;

export function KnowledgeNodeStatus(props: {
  locked?: ResourceNode["knowledgeLocked"];
  state?: ResourceNode["knowledgeState"];
  t: TranslationFn;
}) {
  if (!props.locked) {
    return null;
  }
  const state = props.state ?? "pending";
  const label = props.t(`knowledge.status.${state}`);
  return (
    <span
      className="ml-auto inline-flex shrink-0 items-center gap-1"
      title={label}
      aria-label={label}
    >
      <LockKeyhole className="h-3 w-3 text-[color:var(--app-accent)]" />
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          state === "ready" && "bg-emerald-500",
          state === "stale" && "bg-amber-500",
          state === "failed" && "bg-rose-500",
          (state === "pending" || state === "indexing") && "bg-sky-500",
        )}
      />
    </span>
  );
}
