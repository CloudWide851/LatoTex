import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import type { WorkspacePage } from "../../shared/types/app";

export type PageRailItem = {
  id: WorkspacePage;
  label: string;
  icon: LucideIcon;
};

export function PageRail(props: {
  items: PageRailItem[];
  activePage: WorkspacePage;
  onChange: (next: WorkspacePage) => void;
}) {
  const { items, activePage, onChange } = props;
  return (
    <aside className="rounded-none border-r border-slate-200 bg-transparent p-2 motion-slide-up">
      <div className="flex h-full flex-col gap-2">
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
                "group/rail relative flex h-11 w-11 items-center justify-center rounded-md border transition",
                selected
                  ? "border-primary-600 bg-primary-600 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900",
              )}
              onClick={() => onChange(item.id)}
            >
              <Icon className="h-[18px] w-[18px]" />
              <span className="rail-tooltip">{item.label}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
