import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
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

function clampTooltipPosition(x: number, y: number): { x: number; y: number } {
  if (typeof window === "undefined") {
    return { x, y };
  }
  return {
    x: Math.max(8, Math.min(x, window.innerWidth - 180)),
    y: Math.max(16, Math.min(y, window.innerHeight - 16)),
  };
}

export function PageRail(props: {
  items: PageRailItem[];
  activePage: WorkspacePage;
  onChange: (next: WorkspacePage) => void;
}) {
  const { items, activePage, onChange } = props;
  const [tooltip, setTooltip] = useState<RailTooltip | null>(null);
  const tooltipContainer = useMemo(
    () => (typeof document !== "undefined" ? document.body : null),
    [],
  );

  return (
    <aside className="app-material-shell relative h-full rounded-lg border px-1.5 py-2 motion-slide-up">
      <div className="flex h-full flex-col items-center gap-2">
        {items.map((item) => {
          const Icon = item.icon;
          const selected = activePage === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-label={item.label}
              aria-current={selected ? "page" : undefined}
              title={item.label}
              className={cn(
                "app-page-rail-item relative flex h-11 w-11 items-center justify-center rounded-md border transition",
                selected
                  ? "app-page-rail-item--active"
                  : "app-page-rail-item--idle",
              )}
              onClick={() => onChange(item.id)}
              onMouseEnter={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                const next = clampTooltipPosition(rect.right + 10, rect.top + rect.height / 2);
                setTooltip({
                  label: item.label,
                  x: next.x,
                  y: next.y,
                });
              }}
              onFocus={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                const next = clampTooltipPosition(rect.right + 10, rect.top + rect.height / 2);
                setTooltip({
                  label: item.label,
                  x: next.x,
                  y: next.y,
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
      {tooltip && tooltipContainer
        ? createPortal(
          <div
            className="app-material-floating pointer-events-none fixed z-[320] -translate-y-1/2 whitespace-nowrap rounded-md px-2 py-1 text-[11px]"
            style={{ left: tooltip.x, top: tooltip.y }}
          >
            {tooltip.label}
          </div>,
          tooltipContainer,
        )
        : null}
    </aside>
  );
}
