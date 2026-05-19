import { CircleAlert, CircleHelp, Info } from "lucide-react";
import { cn } from "../../lib/utils";

type HelpTooltipTone = "info" | "help" | "warning";

const toneClass: Record<HelpTooltipTone, string> = {
  info: "text-slate-500 hover:text-slate-700 focus-visible:text-slate-700",
  help: "text-[color:var(--app-accent)] hover:opacity-80 focus-visible:opacity-80",
  warning: "text-amber-600 hover:text-amber-700 focus-visible:text-amber-700",
};

export function HelpTooltip(props: {
  content: string;
  tone?: HelpTooltipTone;
  className?: string;
}) {
  const { content, tone = "info", className } = props;
  const Icon = tone === "warning" ? CircleAlert : tone === "help" ? CircleHelp : Info;

  return (
    <span className={cn("group relative inline-flex shrink-0 items-center", className)}>
      <button
        type="button"
        className={cn(
          "inline-flex h-6 w-6 items-center justify-center rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--control-primary-ring)]",
          toneClass[tone],
        )}
        aria-label={content}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-[420] mt-2 hidden w-64 -translate-x-1/2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs leading-5 text-slate-600 shadow-lg group-hover:block group-focus-within:block"
      >
        {content}
      </span>
    </span>
  );
}
