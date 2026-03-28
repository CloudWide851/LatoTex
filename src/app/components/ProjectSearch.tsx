import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import type { ProjectSearchHit } from "../../shared/types/app";
import { SvgSpinner } from "../../components/ui/svg-spinner";
import { dropdownItemClassName, dropdownSurfaceClassName, useDropdownDismiss } from "../../components/ui/dropdown";

type TranslationFn = (key: any) => string;

export function ProjectSearch(props: {
  query: string;
  onQueryChange: (value: string) => void;
  searching: boolean;
  searched: boolean;
  results: ProjectSearchHit[];
  onSearch: () => void;
  onSelect: (hit: ProjectSearchHit) => void;
  onClear: () => void;
  disabled?: boolean;
  t: TranslationFn;
}) {
  const {
    query,
    onQueryChange,
    searching,
    searched,
    results,
    onSearch,
    onSelect,
    onClear,
    disabled,
    t,
  } = props;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useDropdownDismiss({ open, rootRef, onClose: () => setOpen(false) });

  useEffect(() => {
    if (searching || (searched && query.trim().length > 0)) {
      setOpen(true);
    }
  }, [searching, searched, query]);

  return (
    <div className="relative min-w-0 w-full" ref={rootRef}>
      <div className="app-topbar-field flex h-9 items-center gap-2 px-2.5">
        <Search className="h-4 w-4 shrink-0 text-slate-400" />
        <input
          value={query}
          disabled={disabled}
          placeholder={t("topbar.searchPlaceholder")}
          className="h-full w-full border-none bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-500"
          onChange={(event) => onQueryChange(event.target.value)}
          onFocus={() => {
            if (searched || searching) {
              setOpen(true);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              onSearch();
            }
          }}
        />
        {searching ? (
          <SvgSpinner className="h-4 w-4 shrink-0 text-zinc-400" />
        ) : query.trim().length > 0 ? (
          <button
            className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-transparent text-slate-400 transition hover:border-slate-300/70 hover:bg-white/70 hover:text-slate-700"
            onClick={() => {
              onClear();
              setOpen(false);
            }}
            aria-label={t("topbar.clearSearch")}
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {open && (searched || searching) && (
        <div className={dropdownSurfaceClassName("absolute left-0 top-10 max-h-80 w-full")}>
          {searching ? (
            <div className="px-2 py-1.5 text-xs text-[color:var(--control-muted)]">{t("topbar.searching")}</div>
          ) : results.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-[color:var(--control-muted)]">{t("topbar.noSearchResults")}</div>
          ) : (
            results.map((hit, index) => (
              <button
                key={`${hit.relativePath}:${hit.lineNumber}:${index}`}
                className={dropdownItemClassName(cn(
                  "mb-1 flex-col items-start px-2.5 py-2 last:mb-0",
                  "text-xs hover:border-slate-300/80",
                ))}
                onClick={() => {
                  setOpen(false);
                  onSelect(hit);
                }}
              >
                <div className="truncate font-mono text-[11px] text-[color:var(--control-muted)]">
                  {hit.relativePath}:{hit.lineNumber}
                </div>
                <div className="truncate text-[color:var(--control-muted)]">{hit.snippet}</div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
