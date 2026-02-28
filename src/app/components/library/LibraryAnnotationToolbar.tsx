import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eraser,
  ExternalLink,
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

function swatchClass(active: boolean): string {
  return `h-4 w-4 rounded-full border transition ${active ? "border-slate-800 ring-1 ring-slate-400" : "border-slate-300"}`;
}

export function LibraryAnnotationToolbar(props: {
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
  activeLink: string | null;
  copyState: boolean;
  onOpenLink: () => void;
  onCopyLink: () => void;
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
    activeLink,
    copyState,
    onOpenLink,
    onCopyLink,
  } = props;

  return (
    <>
      <div className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-1 py-0.5">
        <button
          className={`rounded border p-1.5 text-slate-600 transition disabled:opacity-40 ${
            mode === "select"
              ? "border-primary-600 bg-primary-600 text-white hover:bg-primary-700"
              : "border-slate-300 bg-white hover:bg-slate-100"
          }`}
          title={t("library.viewer.toolSelect")}
          aria-label={t("library.viewer.toolSelect")}
          onClick={() => onModeChange("select")}
          disabled={!hasPdf}
        >
          <MousePointer2 className="h-3.5 w-3.5" />
        </button>
        <button
          className={`rounded border p-1.5 text-slate-600 transition disabled:opacity-40 ${
            mode === "highlight"
              ? "border-primary-600 bg-primary-600 text-white hover:bg-primary-700"
              : "border-slate-300 bg-white hover:bg-slate-100"
          }`}
          title={t("preview.annotationEnable")}
          aria-label={t("preview.annotationEnable")}
          onClick={() => onModeChange("highlight")}
          disabled={!hasPdf}
        >
          <Highlighter className="h-3.5 w-3.5" />
        </button>
        <button
          className={`rounded border p-1.5 text-slate-600 transition disabled:opacity-40 ${
            mode === "eraser"
              ? "border-primary-600 bg-primary-600 text-white hover:bg-primary-700"
              : "border-slate-300 bg-white hover:bg-slate-100"
          }`}
          title={t("library.viewer.eraser")}
          aria-label={t("library.viewer.eraser")}
          onClick={() => onModeChange("eraser")}
          disabled={!hasPdf}
        >
          <Eraser className="h-3.5 w-3.5" />
        </button>
        <button
          className={`rounded border p-1.5 text-slate-600 transition disabled:opacity-40 ${
            mode === "textbox"
              ? "border-primary-600 bg-primary-600 text-white hover:bg-primary-700"
              : "border-slate-300 bg-white hover:bg-slate-100"
          }`}
          title={t("library.viewer.textboxMode")}
          aria-label={t("library.viewer.textboxMode")}
          onClick={() => onModeChange("textbox")}
          disabled={!hasPdf}
        >
          <Type className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1">
        <span className="text-[10px] text-slate-500">{t("library.viewer.highlightColor")}</span>
        <div className="flex items-center gap-1">
          {HIGHLIGHT_COLORS.map((color) => (
            <button
              key={color}
              className={swatchClass(highlightColor === color)}
              style={{ backgroundColor: color }}
              onClick={() => onHighlightColorChange(color)}
              title={t("library.viewer.highlightColor")}
              aria-label={t("library.viewer.highlightColor")}
              disabled={!hasPdf}
            />
          ))}
        </div>
      </div>

      <div className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1">
        <span className="text-[10px] text-slate-500">{t("library.viewer.textColor")}</span>
        <div className="flex items-center gap-1">
          {TEXT_COLORS.map((color) => (
            <button
              key={color}
              className={swatchClass(textColor === color)}
              style={{ backgroundColor: color }}
              onClick={() => onTextColorChange(color)}
              title={t("library.viewer.textColor")}
              aria-label={t("library.viewer.textColor")}
              disabled={!hasPdf}
            />
          ))}
        </div>
      </div>

      <button
        className="rounded border border-slate-300 bg-white p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
        title={t("preview.annotationUndo")}
        aria-label={t("preview.annotationUndo")}
        onClick={onUndo}
        disabled={!hasPdf || !canUndo}
      >
        <Undo2 className="h-3.5 w-3.5" />
      </button>
      <button
        className="rounded border border-slate-300 bg-white p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
        title={t("preview.annotationClear")}
        aria-label={t("preview.annotationClear")}
        onClick={onClear}
        disabled={!hasPdf || !canClear}
      >
        <Check className="h-3.5 w-3.5" />
      </button>

      <div className="ml-1 inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-1 py-0.5">
        <button
          className="rounded p-1 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
          onClick={onPrevPage}
          title={t("library.viewer.prevPage")}
          disabled={!hasPdf}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <input
          className="w-10 rounded border border-slate-300 px-1 py-0.5 text-center text-[11px] text-slate-700"
          value={pageInput}
          onChange={(event) => onPageInputChange(event.target.value)}
          onBlur={onPageCommit}
          title={t("library.viewer.pageInput")}
          disabled={!hasPdf}
        />
        <button
          className="rounded p-1 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
          onClick={onNextPage}
          title={t("library.viewer.nextPage")}
          disabled={!hasPdf}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-1 py-0.5">
        <button
          className="rounded p-1 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
          onClick={onZoomOut}
          title={t("preview.zoomOut")}
          disabled={!hasPdf}
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <span className="text-[11px] text-slate-600">{Math.round(pdfZoom * 100)}%</span>
        <button
          className="rounded p-1 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
          onClick={onZoomIn}
          title={t("preview.zoomIn")}
          disabled={!hasPdf}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <button
        className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-100 disabled:opacity-40"
        onClick={onOpenLink}
        disabled={!activeLink}
        title={t("library.viewer.openLink")}
      >
        <ExternalLink className="h-3.5 w-3.5" />
        <span>{t("library.viewer.openLink")}</span>
      </button>
      <button
        className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-100 disabled:opacity-40"
        onClick={onCopyLink}
        disabled={!activeLink}
        title={copyState ? t("library.viewer.copySuccess") : t("library.viewer.copyLink")}
      >
        {copyState ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        <span>{copyState ? t("library.viewer.copySuccess") : t("library.viewer.copyLink")}</span>
      </button>
    </>
  );
}
