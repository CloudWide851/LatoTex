import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Eraser,
  Highlighter,
  Minus,
  MousePointer2,
  Plus,
  Type,
  Undo2,
} from "lucide-react";
import { HIGHLIGHT_COLORS, TEXT_COLORS } from "./annotationPalette";
import type { AnnotationTextStylePreset } from "./annotationModel";

type ToolMode = "select" | "highlight" | "eraser" | "textbox";
type TranslationFn = (key: any) => string;
type PanelKind = "highlight" | "textbox";

function toolButtonClass(active: boolean): string {
  return [
    "inline-flex h-9 w-9 items-center justify-center rounded-xl border transition",
    active
      ? "border-primary-500 bg-primary-50 text-primary-700 shadow-sm"
      : "border-slate-300/90 bg-white text-slate-600 hover:border-slate-400 hover:bg-slate-100",
  ].join(" ");
}

function titleWithShortcut(label: string, shortcut: string): string {
  return `${label} (${shortcut})`;
}

function ColorSwatch(props: {
  color: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
}) {
  const { color, active, disabled, onClick, title } = props;
  return (
    <button
      type="button"
      className={[
        "h-6 w-6 rounded-full border transition",
        active
          ? "border-slate-800 ring-2 ring-primary-200"
          : "border-slate-300 hover:border-slate-500",
      ].join(" ")}
      style={{ backgroundColor: color }}
      disabled={disabled}
      onClick={onClick}
      title={title}
      aria-label={title}
    />
  );
}

export function LibraryPdfToolSidebar(props: {
  t: TranslationFn;
  hasPdf: boolean;
  mode: ToolMode;
  onModeChange: (mode: ToolMode) => void;
  highlightColor: string;
  onHighlightColorChange: (value: string) => void;
  highlightWidth: number;
  onHighlightWidthChange: (value: number) => void;
  highlightOpacity: number;
  onHighlightOpacityChange: (value: number) => void;
  textColor: string;
  onTextColorChange: (value: string) => void;
  textBoxStylePreset: AnnotationTextStylePreset;
  onTextBoxStylePresetChange: (value: AnnotationTextStylePreset) => void;
  canUndo: boolean;
  canClear: boolean;
  onUndo: () => void;
  onClear: () => void;
  pageInput: string;
  onPageInputChange: (value: string) => void;
  onPageCommit: () => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  pdfZoom: number;
  onZoomOut: () => void;
  onZoomIn: () => void;
  openConfigSignal?: number;
}) {
  const {
    t,
    hasPdf,
    mode,
    onModeChange,
    highlightColor,
    onHighlightColorChange,
    highlightWidth,
    onHighlightWidthChange,
    highlightOpacity,
    onHighlightOpacityChange,
    textColor,
    onTextColorChange,
    textBoxStylePreset,
    onTextBoxStylePresetChange,
    canUndo,
    canClear,
    onUndo,
    onClear,
    pageInput,
    onPageInputChange,
    onPageCommit,
    onPrevPage,
    onNextPage,
    pdfZoom,
    onZoomOut,
    onZoomIn,
    openConfigSignal,
  } = props;

  const [panelOpen, setPanelOpen] = useState(false);
  const [panelKind, setPanelKind] = useState<PanelKind>("highlight");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!panelOpen) {
      return;
    }
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        setPanelOpen(false);
        return;
      }
      if (panelRef.current?.contains(target) || containerRef.current?.contains(target)) {
        return;
      }
      setPanelOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPanelOpen(false);
      }
    };
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onEscape);
    };
  }, [panelOpen]);

  useEffect(() => {
    if (!hasPdf || !openConfigSignal) {
      return;
    }
    setPanelKind(mode === "textbox" ? "textbox" : "highlight");
    setPanelOpen(true);
  }, [hasPdf, mode, openConfigSignal]);

  const activePanelTitle = useMemo(
    () =>
      panelKind === "highlight"
        ? t("library.viewer.menu.highlightTitle")
        : t("library.viewer.menu.textboxTitle"),
    [panelKind, t],
  );

  return (
    <div ref={containerRef} className="relative flex h-full">
      <aside className="flex h-full w-14 flex-col items-center gap-2 rounded-xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-2 shadow-sm">
        <button
          className={toolButtonClass(mode === "select")}
          title={titleWithShortcut(t("library.viewer.toolSelect"), t("library.viewer.shortcut.select"))}
          aria-label={titleWithShortcut(t("library.viewer.toolSelect"), t("library.viewer.shortcut.select"))}
          onClick={() => onModeChange("select")}
          disabled={!hasPdf}
        >
          <MousePointer2 className="h-4 w-4" />
        </button>

        <button
          className={toolButtonClass(mode === "highlight")}
          title={titleWithShortcut(t("preview.annotationEnable"), t("library.viewer.shortcut.highlight"))}
          aria-label={titleWithShortcut(t("preview.annotationEnable"), t("library.viewer.shortcut.highlight"))}
          onClick={() => onModeChange("highlight")}
          disabled={!hasPdf}
        >
          <Highlighter className="h-4 w-4" />
          <span
            className="absolute ml-3.5 mt-3.5 h-2.5 w-2.5 rounded-full border border-white shadow"
            style={{ backgroundColor: highlightColor }}
          />
        </button>

        <button
          className={toolButtonClass(mode === "textbox")}
          title={titleWithShortcut(t("library.viewer.textboxMode"), t("library.viewer.shortcut.textbox"))}
          aria-label={titleWithShortcut(t("library.viewer.textboxMode"), t("library.viewer.shortcut.textbox"))}
          onClick={() => onModeChange("textbox")}
          disabled={!hasPdf}
        >
          <Type className="h-4 w-4" />
          <span
            className="absolute ml-3.5 mt-3.5 h-2.5 w-2.5 rounded-full border border-white shadow"
            style={{ backgroundColor: textColor }}
          />
        </button>

        <button
          className={toolButtonClass(mode === "eraser")}
          title={titleWithShortcut(t("library.viewer.eraser"), t("library.viewer.shortcut.eraser"))}
          aria-label={titleWithShortcut(t("library.viewer.eraser"), t("library.viewer.shortcut.eraser"))}
          onClick={() => onModeChange("eraser")}
          disabled={!hasPdf}
        >
          <Eraser className="h-4 w-4" />
        </button>

        <div className="my-0.5 h-px w-8 bg-slate-200" />

        <button
          className={toolButtonClass(false)}
          onClick={onUndo}
          title={titleWithShortcut(t("preview.annotationUndo"), t("shortcut.undo"))}
          aria-label={titleWithShortcut(t("preview.annotationUndo"), t("shortcut.undo"))}
          disabled={!hasPdf || !canUndo}
        >
          <Undo2 className="h-4 w-4" />
        </button>

        <button
          className={toolButtonClass(false)}
          onClick={onClear}
          title={t("preview.annotationClear")}
          aria-label={t("preview.annotationClear")}
          disabled={!hasPdf || !canClear}
        >
          <Check className="h-4 w-4" />
        </button>

        <div className="my-0.5 h-px w-8 bg-slate-200" />

        <button
          className={toolButtonClass(false)}
          onClick={onPrevPage}
          title={titleWithShortcut(t("library.viewer.prevPage"), t("library.viewer.shortcut.prevPage"))}
          disabled={!hasPdf}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        <input
          className="h-8 w-9 rounded-lg border border-slate-300 bg-white px-1 text-center text-[11px] text-slate-700"
          value={pageInput}
          onChange={(event) => onPageInputChange(event.target.value)}
          onBlur={onPageCommit}
          title={t("library.viewer.pageInput")}
          disabled={!hasPdf}
        />

        <button
          className={toolButtonClass(false)}
          onClick={onNextPage}
          title={titleWithShortcut(t("library.viewer.nextPage"), t("library.viewer.shortcut.nextPage"))}
          disabled={!hasPdf}
        >
          <ChevronRight className="h-4 w-4" />
        </button>

        <div className="my-0.5 h-px w-8 bg-slate-200" />

        <button
          className={toolButtonClass(false)}
          onClick={onZoomOut}
          title={titleWithShortcut(t("preview.zoomOut"), t("library.viewer.shortcut.zoomOut"))}
          disabled={!hasPdf}
        >
          <Minus className="h-4 w-4" />
        </button>

        <span className="text-[10px] font-medium text-slate-600">{Math.round(pdfZoom * 100)}%</span>

        <button
          className={toolButtonClass(false)}
          onClick={onZoomIn}
          title={titleWithShortcut(t("preview.zoomIn"), t("library.viewer.shortcut.zoomIn"))}
          disabled={!hasPdf}
        >
          <Plus className="h-4 w-4" />
        </button>
      </aside>

      {panelOpen ? (
        <div
          ref={panelRef}
          className="absolute left-[64px] top-2 z-[75] w-64 rounded-xl border border-slate-300 bg-white/95 p-3 shadow-xl backdrop-blur"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-700">{activePanelTitle}</span>
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
              <button
                className={[
                  "rounded-md px-2 py-1 text-[11px] transition",
                  panelKind === "highlight" ? "bg-white text-slate-900 shadow" : "text-slate-500",
                ].join(" ")}
                onClick={() => setPanelKind("highlight")}
                type="button"
              >
                {t("preview.annotationEnable")}
              </button>
              <button
                className={[
                  "rounded-md px-2 py-1 text-[11px] transition",
                  panelKind === "textbox" ? "bg-white text-slate-900 shadow" : "text-slate-500",
                ].join(" ")}
                onClick={() => setPanelKind("textbox")}
                type="button"
              >
                {t("library.viewer.textboxMode")}
              </button>
            </div>
          </div>

          {panelKind === "highlight" ? (
            <div className="space-y-3">
              <div>
                <div className="mb-1 text-[11px] text-slate-500">{t("library.viewer.highlightColor")}</div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {HIGHLIGHT_COLORS.map((color) => (
                    <ColorSwatch
                      key={color}
                      color={color}
                      active={highlightColor === color}
                      disabled={!hasPdf}
                      onClick={() => onHighlightColorChange(color)}
                      title={t("library.viewer.highlightColor")}
                    />
                  ))}
                </div>
              </div>

              <label className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 text-[11px] text-slate-600">
                <span>{t("library.viewer.menu.highlightWidth")}</span>
                <select
                  className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-[11px]"
                  value={String(highlightWidth)}
                  onChange={(event) => onHighlightWidthChange(Number(event.target.value))}
                >
                  {[10, 14, 18, 24, 30].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 text-[11px] text-slate-600">
                <span>{t("library.viewer.menu.highlightOpacity")}</span>
                <select
                  className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-[11px]"
                  value={String(highlightOpacity)}
                  onChange={(event) => onHighlightOpacityChange(Number(event.target.value))}
                >
                  {[0.45, 0.55, 0.65, 0.8].map((value) => (
                    <option key={value} value={value}>
                      {Math.round(value * 100)}%
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <div className="mb-1 text-[11px] text-slate-500">{t("library.viewer.textColor")}</div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {TEXT_COLORS.map((color) => (
                    <ColorSwatch
                      key={color}
                      color={color}
                      active={textColor === color}
                      disabled={!hasPdf}
                      onClick={() => onTextColorChange(color)}
                      title={t("library.viewer.textColor")}
                    />
                  ))}
                </div>
              </div>

              <label className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 text-[11px] text-slate-600">
                <span>{t("library.viewer.menu.textboxStyle")}</span>
                <select
                  className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-[11px]"
                  value={textBoxStylePreset}
                  onChange={(event) =>
                    onTextBoxStylePresetChange(event.target.value as AnnotationTextStylePreset)
                  }
                >
                  <option value="minimal">{t("library.viewer.textboxStyle.minimal")}</option>
                  <option value="boxed">{t("library.viewer.textboxStyle.boxed")}</option>
                  <option value="note">{t("library.viewer.textboxStyle.note")}</option>
                </select>
              </label>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
