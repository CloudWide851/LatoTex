import { useEffect, useRef, useState } from "react";
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
type ConfigMenuState =
  | {
      kind: "highlight" | "textbox";
      x: number;
      y: number;
    }
  | null;

function toolButtonClass(active: boolean): string {
  return [
    "inline-flex h-8 w-8 items-center justify-center rounded-md border transition",
    active
      ? "border-primary-600 bg-primary-600 text-white"
      : "border-slate-300 bg-white text-slate-600 hover:bg-slate-100",
  ].join(" ");
}

function titleWithShortcut(label: string, shortcut: string): string {
  return `${label} (${shortcut})`;
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
  } = props;

  const [menu, setMenu] = useState<ConfigMenuState>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!menu) {
      return;
    }
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        setMenu(null);
        return;
      }
      if (menuRef.current && menuRef.current.contains(target)) {
        return;
      }
      setMenu(null);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenu(null);
      }
    };
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onEscape);
    };
  }, [menu]);

  return (
    <>
      <aside className="flex h-full w-12 flex-col items-center gap-2 rounded border border-slate-200 bg-slate-50 px-1 py-2">
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
          style={mode === "highlight" ? { backgroundColor: highlightColor, borderColor: highlightColor } : undefined}
          title={`${titleWithShortcut(t("preview.annotationEnable"), t("library.viewer.shortcut.highlight"))} · ${t("library.viewer.configureHint")}`}
          aria-label={titleWithShortcut(t("preview.annotationEnable"), t("library.viewer.shortcut.highlight"))}
          onClick={() => onModeChange("highlight")}
          onContextMenu={(event) => {
            event.preventDefault();
            if (!hasPdf) {
              return;
            }
            setMenu({ kind: "highlight", x: event.clientX, y: event.clientY });
          }}
          disabled={!hasPdf}
        >
          <Highlighter className="h-4 w-4" />
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
        <button
          className={toolButtonClass(mode === "textbox")}
          style={mode === "textbox" ? { backgroundColor: textColor, borderColor: textColor } : undefined}
          title={`${titleWithShortcut(t("library.viewer.textboxMode"), t("library.viewer.shortcut.textbox"))} · ${t("library.viewer.configureHint")}`}
          aria-label={titleWithShortcut(t("library.viewer.textboxMode"), t("library.viewer.shortcut.textbox"))}
          onClick={() => onModeChange("textbox")}
          onContextMenu={(event) => {
            event.preventDefault();
            if (!hasPdf) {
              return;
            }
            setMenu({ kind: "textbox", x: event.clientX, y: event.clientY });
          }}
          disabled={!hasPdf}
        >
          <Type className="h-4 w-4" />
        </button>

        <div className="my-1 h-px w-8 bg-slate-200" />

        <select
          className="h-7 w-10 rounded border border-slate-300 bg-white px-1 text-[10px] text-slate-700"
          value={highlightColor}
          onChange={(event) => onHighlightColorChange(event.target.value)}
          title={t("library.viewer.highlightColor")}
          disabled={!hasPdf}
        >
          {HIGHLIGHT_COLORS.map((color, index) => (
            <option key={color} value={color}>
              {index + 1}
            </option>
          ))}
        </select>
        <select
          className="h-7 w-10 rounded border border-slate-300 bg-white px-1 text-[10px] text-slate-700"
          value={textColor}
          onChange={(event) => onTextColorChange(event.target.value)}
          title={t("library.viewer.textColor")}
          disabled={!hasPdf}
        >
          {TEXT_COLORS.map((color, index) => (
            <option key={color} value={color}>
              {index + 1}
            </option>
          ))}
        </select>

        <div className="my-1 h-px w-8 bg-slate-200" />

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

        <div className="my-1 h-px w-8 bg-slate-200" />

        <button
          className={toolButtonClass(false)}
          onClick={onPrevPage}
          title={titleWithShortcut(t("library.viewer.prevPage"), t("library.viewer.shortcut.prevPage"))}
          disabled={!hasPdf}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <input
          className="h-7 w-10 rounded border border-slate-300 bg-white px-1 text-center text-[10px] text-slate-700"
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

        <div className="my-1 h-px w-8 bg-slate-200" />

        <button
          className={toolButtonClass(false)}
          onClick={onZoomOut}
          title={titleWithShortcut(t("preview.zoomOut"), t("library.viewer.shortcut.zoomOut"))}
          disabled={!hasPdf}
        >
          <Minus className="h-4 w-4" />
        </button>
        <span className="text-[10px] text-slate-600">{Math.round(pdfZoom * 100)}%</span>
        <button
          className={toolButtonClass(false)}
          onClick={onZoomIn}
          title={titleWithShortcut(t("preview.zoomIn"), t("library.viewer.shortcut.zoomIn"))}
          disabled={!hasPdf}
        >
          <Plus className="h-4 w-4" />
        </button>
      </aside>

      {menu ? (
        <div
          ref={menuRef}
          className="fixed z-[75] w-56 rounded-md border border-slate-300 bg-white p-2 shadow-xl"
          style={{ left: menu.x + 8, top: menu.y + 8 }}
        >
          {menu.kind === "highlight" ? (
            <div className="space-y-2">
              <div className="text-[11px] font-semibold text-slate-700">{t("library.viewer.menu.highlightTitle")}</div>
              <label className="flex items-center justify-between gap-2 text-[11px] text-slate-600">
                <span>{t("library.viewer.menu.highlightWidth")}</span>
                <select
                  className="h-7 w-20 rounded border border-slate-300 bg-white px-1 text-[11px]"
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
              <label className="flex items-center justify-between gap-2 text-[11px] text-slate-600">
                <span>{t("library.viewer.menu.highlightOpacity")}</span>
                <select
                  className="h-7 w-20 rounded border border-slate-300 bg-white px-1 text-[11px]"
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
            <div className="space-y-2">
              <div className="text-[11px] font-semibold text-slate-700">{t("library.viewer.menu.textboxTitle")}</div>
              <label className="flex items-center justify-between gap-2 text-[11px] text-slate-600">
                <span>{t("library.viewer.menu.textboxStyle")}</span>
                <select
                  className="h-7 w-28 rounded border border-slate-300 bg-white px-1 text-[11px]"
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
    </>
  );
}
