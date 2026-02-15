import { ChevronDown, Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import type { ProjectSummary } from "../../shared/types/app";

type TranslationFn = (key: any) => string;

export function ProjectSwitcher(props: {
  projects: ProjectSummary[];
  activeProjectId: string | null;
  disabled?: boolean;
  onChange: (projectId: string | null) => void;
  t: TranslationFn;
}) {
  const { projects, activeProjectId, disabled, onChange, t } = props;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current) {
        return;
      }
      if (!rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, []);

  const active = projects.find((item) => item.id === activeProjectId);
  const label = active?.name ?? t("workspace.noProject");

  return (
    <div className="relative min-w-[220px] max-w-[320px]" ref={rootRef}>
      <button
        type="button"
        aria-label={t("topbar.selectProject")}
        className={cn(
          "flex h-9 w-full items-center justify-between rounded-md border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800",
          disabled && "cursor-not-allowed opacity-60"
        )}
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 transition", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute left-0 top-10 z-50 max-h-72 w-full overflow-auto rounded-md border border-zinc-700 bg-zinc-900 p-1 shadow-lg">
          {projects.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-zinc-400">{t("workspace.noProject")}</div>
          ) : (
            projects.map((project) => {
              const selected = project.id === activeProjectId;
              return (
                <button
                  key={project.id}
                  className={cn(
                    "flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm transition",
                    selected
                      ? "bg-primary-600 text-white"
                      : "text-zinc-200 hover:bg-zinc-800"
                  )}
                  onClick={() => {
                    setOpen(false);
                    onChange(project.id);
                  }}
                >
                  <span className="truncate">{project.name}</span>
                  {selected && <Check className="h-4 w-4 shrink-0" />}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
