import { Check, ChevronDown, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/utils";
import type { ProjectSummary } from "../../shared/types/app";
import {
  buildFloatingSurfaceStyle,
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
  const [panelStyle, setPanelStyle] = useState({});
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useDropdownDismiss({
    open,
    rootRef,
    includeRefs: [panelRef],
    onClose: () => setOpen(false),
  });

  useEffect(() => {
    if (!open) {
      setQuery("");
    }
  }, [open]);

  const updatePanelPosition = useCallback(() => {
    const trigger = rootRef.current;
    if (!trigger) {
      return;
    }
    const rect = trigger.getBoundingClientRect();
    setPanelStyle(buildFloatingSurfaceStyle(trigger, {
      minWidth: Math.max(rect.width, 220),
      preferredWidth: Math.max(rect.width, 260),
      maxWidth: 360,
      align: "start",
      desiredHeight: 288,
    }));
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    updatePanelPosition();
    const handleReposition = () => updatePanelPosition();
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    return () => {
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [open, updatePanelPosition]);

  const active = projects.find((item) => item.id === activeProjectId);
  const label = active?.name ?? t("workspace.noProject");
  const filtered = projects.filter((project) =>
    project.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const panel = open ? (
    <div
      ref={panelRef}
      className={dropdownSurfaceClassName("fixed z-[520] max-h-[min(18rem,calc(100vh-3.5rem))] overflow-y-auto overflow-x-hidden")}
      style={panelStyle}
    >
      <div className="p-1.5">
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
                  selected && "control-menu-item--selected",
                ))}
                onClick={() => {
                  setOpen(false);
                  setQuery("");
                  onChange(project.id);
                }}
              >
                <span className="truncate">{project.name}</span>
                <Check className={cn("h-4 w-4 shrink-0", !selected && "opacity-0")} />
              </button>
            );
          })
        )}
      </div>
    </div>
  ) : null;

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

      {panel && typeof document !== "undefined" ? createPortal(panel, document.body) : panel}
    </div>
  );
}
