import { ChevronDown, Check, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import type { ProjectSummary } from "../../shared/types/app";
import { dropdownItemClassName, dropdownSurfaceClassName, useDropdownDismiss } from "../../components/ui/dropdown";

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
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);

  useDropdownDismiss({ open, rootRef, onClose: () => setOpen(false) });

  useEffect(() => {
    if (!open) {
      setQuery("");
    }
  }, [open]);

  const active = projects.find((item) => item.id === activeProjectId);
  const label = active?.name ?? t("workspace.noProject");
  const filtered = projects.filter((project) =>
    project.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div className="relative min-w-0 w-full" ref={rootRef}>
      <button
        type="button"
        aria-label={t("topbar.selectProject")}
        className={cn(
          "app-topbar-field flex h-9 w-full items-center justify-between rounded-md px-3 text-sm transition",
          disabled && "cursor-not-allowed opacity-60"
        )}
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 transition", open && "rotate-180")} />
      </button>

      {open && (
        <div className={dropdownSurfaceClassName("absolute left-0 top-10 max-h-72 w-full p-1.5")}>
          <div className="mb-1.5 flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-slate-50 px-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-slate-500" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("topbar.projectFilterPlaceholder")}
              className="h-full w-full border-none bg-transparent text-xs text-slate-800 outline-none placeholder:text-slate-500"
            />
          </div>
          {projects.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-slate-500">{t("workspace.noProject")}</div>
          ) : filtered.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-slate-500">{t("topbar.noProjectMatches")}</div>
          ) : (
            filtered.map((project) => {
              const selected = project.id === activeProjectId;
              return (
                <button
                  key={project.id}
                  className={dropdownItemClassName(cn(
                    "mb-1 justify-between text-sm last:mb-0",
                    selected
                      ? "bg-primary-600 text-white hover:bg-primary-500 hover:text-white"
                      : "text-slate-700"
                  ))}
                  onClick={() => {
                    setOpen(false);
                    setQuery("");
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
