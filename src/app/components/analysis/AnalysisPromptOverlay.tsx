import { Play, UsersRound } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { cn } from "../../../lib/utils";
import { SvgSpinner } from "../../../components/ui/svg-spinner";
import { applyPromptRefSuggestion, suggestPromptRefs } from "../../hooks/analysisPromptRefs";

type TranslationFn = (key: any) => string;

function parseDroppedPaths(event: DragEvent): string[] {
  const dataTransfer = event.dataTransfer;
  const customRaw = dataTransfer.getData("application/x-latotex-path");
  const customPaths = customRaw
    .split(/\r?\n/g)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const plainRaw = dataTransfer.getData("text/plain");
  const plainPaths = plainRaw
    .split(/\r?\n/g)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return Array.from(new Set([...customPaths, ...plainPaths]));
}

export function AnalysisPromptOverlay(props: {
  prompt: string;
  canRun: boolean;
  running: boolean;
  busy: boolean;
  candidateFiles: string[];
  embedded?: boolean;
  onPromptChange: (value: string) => void;
  onDropPaths: (paths: string[]) => void;
  onRun: () => void;
  onRunTeams: () => void;
  t: TranslationFn;
}) {
  const { prompt, canRun, running, busy, candidateFiles, embedded = false, onPromptChange, onDropPaths, onRun, onRunTeams, t } = props;
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const [suggestionPlacement, setSuggestionPlacement] = useState<"above" | "below">("above");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const suggestions = useMemo(() => suggestPromptRefs(prompt, candidateFiles), [candidateFiles, prompt]);
  const suggestionPanelWidth = useMemo(() => {
    const maxNameLength = suggestions.reduce((max, path) => {
      const fileName = path.split("/").pop() || path;
      return Math.max(max, fileName.length);
    }, 0);
    return Math.min(460, Math.max(180, maxNameLength * 9 + 56));
  }, [suggestions]);

  useEffect(() => {
    setSuggestionIndex((prev) => Math.min(prev, Math.max(0, suggestions.length - 1)));
  }, [suggestions.length]);

  const updateSuggestionPlacement = () => {
    if (suggestions.length === 0 || !textareaRef.current || typeof window === "undefined") {
      return;
    }
    const el = textareaRef.current;
    const rect = el.getBoundingClientRect();
    const caret = el.selectionStart ?? prompt.length;
    const beforeCaret = el.value.slice(0, caret);
    const currentLine = beforeCaret.split(/\r?\n/g).length;
    const totalLines = Math.max(el.value.split(/\r?\n/g).length, 1);
    const prefersBelow = currentLine <= Math.ceil(totalLines / 2);
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    if (prefersBelow && spaceBelow >= 150) {
      setSuggestionPlacement("below");
      return;
    }
    if (!prefersBelow && spaceAbove >= 150) {
      setSuggestionPlacement("above");
      return;
    }
    setSuggestionPlacement(spaceBelow >= spaceAbove ? "below" : "above");
  };

  useEffect(() => {
    updateSuggestionPlacement();
  }, [prompt, suggestions.length]);

  const applySuggestionAtIndex = (index: number) => {
    const target = suggestions[index];
    if (!target) {
      return;
    }
    onPromptChange(applyPromptRefSuggestion(prompt, target));
    setSuggestionIndex(0);
  };

  return (
    <div
      className={embedded
        ? "flex justify-center"
        : "pointer-events-none absolute inset-x-3 bottom-3 z-20 flex justify-center"}
    >
      <div
        className={cn(
          "w-[min(920px,100%)] rounded-lg border border-slate-300 bg-white/95 p-3 shadow-soft motion-slide-up",
          embedded ? "" : "pointer-events-auto",
        )}
      >
        <div className="relative">
          <textarea
            ref={textareaRef}
            className={cn(
              "hide-scrollbar h-[96px] w-full resize-none overflow-auto rounded-lg border border-slate-300 bg-white px-3 pb-12 pt-2 pr-24 text-sm text-slate-700 outline-none transition",
              "focus:border-primary-500 focus:ring-2 focus:ring-primary-100",
              dragActive ? "border-primary-500 bg-primary-50/50" : "",
            )}
            value={prompt}
            placeholder={t("analysis.promptPlaceholder")}
            onChange={(event) => onPromptChange(event.target.value)}
            onClick={updateSuggestionPlacement}
            onKeyUp={updateSuggestionPlacement}
            onSelect={updateSuggestionPlacement}
            onDragOver={(event) => {
              event.preventDefault();
              if (!dragActive) {
                setDragActive(true);
              }
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              onDropPaths(parseDroppedPaths(event));
            }}
            onKeyDown={(event) => {
              if (suggestions.length > 0 && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
                event.preventDefault();
                const delta = event.key === "ArrowDown" ? 1 : -1;
                setSuggestionIndex((prev) => Math.max(0, Math.min(suggestions.length - 1, prev + delta)));
                return;
              }
              if (suggestions.length > 0 && (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey))) {
                const hasAtRefQuery = /(?:^|\s)@(?:"[^"]*"?|[^\s"]*)$/.test(prompt);
                if (hasAtRefQuery) {
                  event.preventDefault();
                  applySuggestionAtIndex(suggestionIndex);
                  return;
                }
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (!busy && canRun && !running) {
                  onRun();
                }
              }
            }}
          />
          {suggestions.length > 0 ? (
            <div
              className={cn(
                "absolute left-2 z-20 max-h-36 overflow-auto rounded-md border border-slate-200 bg-white p-1 shadow-soft",
                suggestionPlacement === "above"
                  ? "bottom-[calc(100%+6px)]"
                  : "top-[calc(100%+6px)]",
              )}
              style={{
                width: suggestionPanelWidth,
                maxWidth: "min(75%, 460px)",
              }}
            >
              {suggestions.map((path, index) => (
                <button
                  key={path}
                  className={cn(
                    "flex w-full items-start gap-2 rounded px-2 py-1 text-left text-xs transition",
                    index === suggestionIndex ? "bg-primary-50 text-primary-700" : "text-slate-700 hover:bg-slate-100",
                  )}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    applySuggestionAtIndex(index);
                  }}
                  title={path}
                >
                  <span className="whitespace-nowrap font-medium">@{path.split("/").pop() || path}</span>
                </button>
              ))}
            </div>
          ) : null}
          <div className="absolute bottom-2 right-2 flex items-center gap-2">
            {!running ? (
              <button
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-100 disabled:opacity-40"
                title={t("agent.teams.run")}
                aria-label={t("agent.teams.run")}
                onClick={onRunTeams}
                disabled={!canRun || busy}
              >
                <UsersRound className="h-4 w-4" />
              </button>
            ) : null}
            <button
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-primary-600 bg-primary-600 text-white transition hover:bg-primary-700 disabled:opacity-40"
              title={running ? t("analysis.running") : t("analysis.run")}
              aria-label={running ? t("analysis.running") : t("analysis.run")}
              onClick={onRun}
              disabled={!canRun || running || busy}
            >
              {running ? <SvgSpinner className="h-4 w-4 text-white" /> : <Play className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

