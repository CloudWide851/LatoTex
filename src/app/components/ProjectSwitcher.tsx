import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import type { ProjectSummary } from "../../shared/types/app";
import {
  dropdownItemClassName,
  dropdownSearchInputClassName,
  dropdownSearchRowClassName,
  dropdownSurfaceClassName,
  useDropdownDismiss,
} from "../../components/ui/dropdown";

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
          "app-topbar-field motion-hover-rise flex h-9 w-full items-center justify-between px-3 text-sm transition",
          disabled && "cursor-not-allowed opacity-60",
        )}
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="truncate font-medium tracking-[0.01em]">{label}</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 transition", open && "rotate-180")} />
      </button>

      {open && (
        <div className={dropdownSurfaceClassName("absolute left-0 top-10 max-h-72 w-full")}>
          <div className={dropdownSearchRowClassName("mb-1.5 h-9")}>
            <Search className="h-3.5 w-3.5 shrink-0 text-[color:var(--control-muted)]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("topbar.projectFilterPlaceholder")}
              className={dropdownSearchInputClassName()}
            />
          </div>
          {projects.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-[color:var(--control-muted)]">{t("workspace.noProject")}</div>
          ) : filtered.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-[color:var(--control-muted)]">{t("topbar.noProjectMatches")}</div>
          ) : (
            filtered.map((project) => {
              const selected = project.id === activeProjectId;
              return (
                <button
                  key={project.id}
                  className={dropdownItemClassName(cn(
                    "mb-1 justify-between text-sm last:mb-0",
                    selected
                      ? "border-primary-500/60 bg-[linear-gradient(180deg,#3b82f6,#2563eb)] text-white shadow-[0_16px_28px_rgba(37,99,235,0.24)] hover:text-white"
                      : "text-[color:var(--control-text)]",
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
