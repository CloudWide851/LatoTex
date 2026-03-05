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

type ToolMode = "select" | "highlight" | "eraser" | "textbox";
type TranslationFn = (key: any) => string;

function toolButtonClass(active: boolean): string {
  return [
    "inline-flex h-8 w-8 items-center justify-center rounded-md border transition",
    active
      ? "border-primary-600 bg-primary-600 text-white"
      : "border-slate-300 bg-white text-slate-600 hover:bg-slate-100",
  ].join(" ");
}

export function LibraryPdfToolSidebar(props: {
  t: TranslationFn;
  hasPdf: boolean;
  mode: ToolMode;
  onModeChange: (mode: ToolMode) => void;
  highlightColor: string;
  onHighlightColorChange: (value: string) => void;
  textColor: string;
  onTextColorChange: (value: string) => void;
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
    textColor,
    onTextColorChange,
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

  return (
    <aside className="flex h-full w-12 flex-col items-center gap-2 rounded border border-slate-200 bg-slate-50 px-1 py-2">
      <button
        className={toolButtonClass(mode === "select")}
        title={t("library.viewer.toolSelect")}
        aria-label={t("library.viewer.toolSelect")}
        onClick={() => onModeChange("select")}
        disabled={!hasPdf}
      >
        <MousePointer2 className="h-4 w-4" />
      </button>
      <button
        className={toolButtonClass(mode === "highlight")}
        style={mode === "highlight" ? { backgroundColor: highlightColor, borderColor: highlightColor } : undefined}
        title={t("preview.annotationEnable")}
        aria-label={t("preview.annotationEnable")}
        onClick={() => onModeChange("highlight")}
        disabled={!hasPdf}
      >
        <Highlighter className="h-4 w-4" />
      </button>
      <button
        className={toolButtonClass(mode === "eraser")}
        title={t("library.viewer.eraser")}
        aria-label={t("library.viewer.eraser")}
        onClick={() => onModeChange("eraser")}
        disabled={!hasPdf}
      >
        <Eraser className="h-4 w-4" />
      </button>
      <button
        className={toolButtonClass(mode === "textbox")}
        style={mode === "textbox" ? { backgroundColor: textColor, borderColor: textColor } : undefined}
        title={t("library.viewer.textboxMode")}
        aria-label={t("library.viewer.textboxMode")}
        onClick={() => onModeChange("textbox")}
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
        title={t("preview.annotationUndo")}
        aria-label={t("preview.annotationUndo")}
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
        title={t("library.viewer.prevPage")}
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
        title={t("library.viewer.nextPage")}
        disabled={!hasPdf}
      >
        <ChevronRight className="h-4 w-4" />
      </button>

      <div className="my-1 h-px w-8 bg-slate-200" />

      <button
        className={toolButtonClass(false)}
        onClick={onZoomOut}
        title={t("preview.zoomOut")}
        disabled={!hasPdf}
      >
        <Minus className="h-4 w-4" />
      </button>
      <span className="text-[10px] text-slate-600">{Math.round(pdfZoom * 100)}%</span>
      <button
        className={toolButtonClass(false)}
        onClick={onZoomIn}
        title={t("preview.zoomIn")}
        disabled={!hasPdf}
      >
        <Plus className="h-4 w-4" />
      </button>
    </aside>
  );
}
