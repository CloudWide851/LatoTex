import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import type { ProjectSearchHit } from "../../shared/types/app";
import { SvgSpinner } from "../../components/ui/svg-spinner";

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
    t
  } = props;
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

  useEffect(() => {
    if (searching || (searched && query.trim().length > 0)) {
      setOpen(true);
    }
  }, [searching, searched, query]);

  return (
    <div className="relative w-full min-w-[180px] max-w-[min(42vw,460px)]" ref={rootRef}>
      <div className="app-topbar-field flex h-9 items-center gap-2 rounded-md px-2">
        <Search className="h-4 w-4 shrink-0 text-slate-400 dark:text-zinc-400" />
        <input
          value={query}
          disabled={disabled}
          placeholder={t("topbar.searchPlaceholder")}
          className="h-full w-full border-none bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-500 dark:text-zinc-100 dark:placeholder:text-zinc-500"
          onChange={(event) => onQueryChange(event.target.value)}
          onFocus={() => {
            if (searched || searching) {
              setOpen(true);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              onSearch();
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        {searching ? (
          <SvgSpinner className="h-4 w-4 shrink-0 text-zinc-400" />
        ) : query.trim().length > 0 ? (
          <button
            className="rounded p-0.5 text-slate-400 transition hover:bg-slate-200 hover:text-slate-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
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
        <div className="absolute left-0 top-10 z-50 max-h-80 w-full overflow-auto rounded-md border border-slate-300 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {searching ? (
            <div className="px-2 py-1.5 text-xs text-slate-500 dark:text-zinc-400">{t("topbar.searching")}</div>
          ) : results.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-slate-500 dark:text-zinc-400">{t("topbar.noSearchResults")}</div>
          ) : (
            results.map((hit, index) => (
              <button
                key={`${hit.relativePath}:${hit.lineNumber}:${index}`}
                className={cn(
                  "mb-1 w-full rounded border border-slate-200 px-2 py-1.5 text-left text-xs transition last:mb-0 dark:border-zinc-800",
                  "bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-slate-100 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-zinc-700 dark:hover:bg-zinc-800"
                )}
                onClick={() => {
                  setOpen(false);
                  onSelect(hit);
                }}
              >
                <div className="truncate font-mono text-[11px] text-slate-500 dark:text-zinc-300">
                  {hit.relativePath}:{hit.lineNumber}
                </div>
                <div className="truncate text-slate-500 dark:text-zinc-400">{hit.snippet}</div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
