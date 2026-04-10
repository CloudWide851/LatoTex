import {
  Check,
  Copy,
  ExternalLink,
  FileSearch,
  FileText,
  Languages,
  RotateCcw,
} from "lucide-react";
import { filenameFromPath } from "./viewerUtils";

type TranslationFn = (key: any) => string;
type ViewMode = "bib" | "pdf" | "compare";

export function LibraryDocumentToolbar(props: {
  selectedPath: string;
  viewMode: ViewMode;
  documentBusy: boolean;
  analysisRunning: boolean;
  translationBusy: boolean;
  hasTranslated: boolean;
  translationNotice: { type: "info" | "error"; message: string } | null;
  activeLink: string | null;
  copyState: boolean;
  onViewModeChange: (mode: ViewMode) => void;
  onOpenPdf: () => void;
  onAnalyzePaper: () => void;
  onCompareAction: () => void;
  onRetranslate: () => void;
  onOpenLink: () => void;
  onCopyLink: () => void;
  t: TranslationFn;
}) {
  const {
    selectedPath,
    viewMode,
    documentBusy,
    analysisRunning,
    translationBusy,
    hasTranslated,
    translationNotice,
    activeLink,
    copyState,
    onViewModeChange,
    onOpenPdf,
    onAnalyzePaper,
    onCompareAction,
    onRetranslate,
    onOpenLink,
    onCopyLink,
    t,
  } = props;

  const actionBtnClass = "panel-topbar-btn motion-hover-rise inline-flex items-center justify-center rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40";

  return (
    <section className="panel-topbar flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 motion-shell-stage motion-panel-glow">
      <div className="flex min-w-0 items-center gap-2">
        <FileText className="h-3.5 w-3.5 text-slate-500" />
        <span className="panel-topbar-text truncate text-sm font-medium text-slate-700">
          {filenameFromPath(selectedPath)}
        </span>
        {translationNotice ? (
          <span
            className={`max-w-[240px] truncate rounded-full px-2 py-0.5 text-[11px] ${
              translationNotice.type === "info"
                ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border border-rose-200 bg-rose-50 text-rose-700"
            }`}
            title={translationNotice.message}
          >
            {translationNotice.message}
          </span>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-nowrap items-center gap-1 overflow-x-auto py-1">
        <button
          className={`panel-topbar-text rounded border px-2 py-1 text-[11px] ${
            viewMode === "bib"
              ? "border-primary-300 bg-primary-50 text-primary-900"
              : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
          }`}
          onClick={() => onViewModeChange("bib")}
          title={t("library.viewer.showBib")}
        >
          {t("library.viewer.showBib")}
        </button>
        <button
          className={`panel-topbar-text rounded border px-2 py-1 text-[11px] ${
            viewMode === "pdf"
              ? "border-primary-300 bg-primary-50 text-primary-900"
              : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
          }`}
          onClick={onOpenPdf}
          title={t("library.viewer.showPdf")}
        >
          {t("library.viewer.showPdf")}
        </button>
        <button
          className={actionBtnClass}
          onClick={onAnalyzePaper}
          title={t("library.viewer.analyzePaper")}
          disabled={documentBusy || analysisRunning}
        >
          <FileSearch className="h-3.5 w-3.5" />
        </button>
        <button
          className={actionBtnClass}
          onClick={onCompareAction}
          title={translationBusy
            ? t("library.viewer.translating")
            : hasTranslated
              ? t("library.viewer.showCompare")
              : t("library.viewer.translatePaper")}
          disabled={documentBusy || translationBusy}
        >
          <Languages className={`h-3.5 w-3.5 ${translationBusy ? "animate-pulse" : ""}`} />
        </button>
        <button
          className={actionBtnClass}
          onClick={onRetranslate}
          title={t("library.viewer.retranslatePaper")}
          disabled={documentBusy || translationBusy}
        >
          <RotateCcw className={`h-3.5 w-3.5 ${translationBusy ? "motion-rotate-soft" : ""}`} />
        </button>
        {viewMode === "pdf" ? (
          <>
            <button
              className={actionBtnClass}
              onClick={onOpenLink}
              disabled={!activeLink}
              title={t("library.viewer.openLink")}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
            <button
              className={actionBtnClass}
              onClick={onCopyLink}
              disabled={!activeLink}
              title={copyState ? t("library.viewer.copySuccess") : t("library.viewer.copyLink")}
            >
              {copyState ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </>
        ) : null}
      </div>
    </section>
  );
}
