import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import type { WorkspacePage } from "../../shared/types/app";

export type PageRailItem = {
  id: WorkspacePage;
  label: string;
  icon: LucideIcon;
};

type RailTooltip = {
  label: string;
  x: number;
  y: number;
};

export function PageRail(props: {
  items: PageRailItem[];
  activePage: WorkspacePage;
  onChange: (next: WorkspacePage) => void;
}) {
  const { items, activePage, onChange } = props;
  const [tooltip, setTooltip] = useState<RailTooltip | null>(null);

  return (
    <aside className="relative h-full bg-transparent px-1.5 py-2 motion-slide-up">
      <div className="flex h-full flex-col items-center gap-2">
        {items.map((item) => {
          const Icon = item.icon;
          const selected = activePage === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-label={item.label}
              title={item.label}
              className={cn(
                "relative flex h-11 w-11 items-center justify-center rounded-md border transition",
                selected
                  ? "border-primary-600 bg-primary-600 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900",
              )}
              onClick={() => onChange(item.id)}
              onMouseEnter={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setTooltip({
                  label: item.label,
                  x: rect.right + 10,
                  y: rect.top + rect.height / 2,
                });
              }}
              onFocus={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setTooltip({
                  label: item.label,
                  x: rect.right + 10,
                  y: rect.top + rect.height / 2,
                });
              }}
              onMouseLeave={() => setTooltip((prev) => (prev?.label === item.label ? null : prev))}
              onBlur={() => setTooltip((prev) => (prev?.label === item.label ? null : prev))}
            >
              <Icon className="h-[18px] w-[18px]" />
            </button>
          );
        })}
      </div>
      {tooltip && (
        <div
          className="pointer-events-none fixed z-[80] -translate-y-1/2 whitespace-nowrap rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-100 shadow-lg"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          {tooltip.label}
        </div>
      )}
    </aside>
  );
}
