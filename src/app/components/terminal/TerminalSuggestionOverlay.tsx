import type { TerminalSuggestion } from "./terminalSuggestions";

export function TerminalSuggestionOverlay(props: {
  suggestions: TerminalSuggestion[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}) {
  const { suggestions, selectedIndex, onSelect } = props;
  if (suggestions.length === 0) {
    return null;
  }
  return (
    <div className="pointer-events-auto absolute bottom-3 left-3 z-20 w-[min(520px,calc(100%-24px))] overflow-hidden rounded-md border border-slate-700 bg-slate-950/96 text-xs shadow-soft">
      {suggestions.map((suggestion, index) => (
        <button
          key={`${suggestion.value}-${index}`}
          type="button"
          className={`flex w-full items-center justify-between gap-3 px-2.5 py-1.5 text-left ${
            index === selectedIndex ? "bg-slate-800 text-emerald-200" : "text-slate-200 hover:bg-slate-900"
          }`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onSelect(index)}
        >
          <span className="min-w-0 truncate font-mono">{suggestion.label}</span>
          <span className="shrink-0 text-[10px] uppercase tracking-wide text-slate-500">{suggestion.detail}</span>
        </button>
      ))}
    </div>
  );
}
