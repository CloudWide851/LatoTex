import { Check, Copy, ExternalLink, Languages, LoaderCircle } from "lucide-react";
import type { LibraryCitationSummary } from "../../../shared/types/app";

type TranslationFn = (key: any) => string;

type PaperPreview = {
  title?: string | null;
  detectedLanguage?: string | null;
  extractionEngine?: string | null;
  pageCount?: number | null;
  excerpt?: string | null;
} | null;

function statusLabel(
  value: "ready" | "pending" | "error" | "missing",
  t: TranslationFn,
): string {
  return t(`library.viewer.state.${value}`);
}

function formatByteCount(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** index);
  return `${value >= 100 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function StatusPill(props: {
  label: string;
  tone: "neutral" | "info" | "success" | "danger";
}) {
  const toneClassName = {
    neutral: "border-slate-300 bg-white text-slate-600",
    info: "border-sky-200 bg-sky-50 text-sky-700",
    success: "border-emerald-200 bg-emerald-50 text-emerald-700",
    danger: "border-rose-200 bg-rose-50 text-rose-700",
  }[props.tone];

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${toneClassName}`}>
      {props.label}
    </span>
  );
}

function statusTone(value: "ready" | "pending" | "error" | "missing"): "neutral" | "info" | "success" | "danger" {
  if (value === "ready") {
    return "success";
  }
  if (value === "pending") {
    return "info";
  }
  if (value === "error") {
    return "danger";
  }
  return "neutral";
}

export function LibraryDocumentSidebar(props: {
  citation: LibraryCitationSummary | null;
  activeLink: string | null;
  linkError: string | null;
  copyState: boolean;
  paperPreview: PaperPreview;
  paperPreviewLoading: boolean;
  paperPreviewError: string | null;
  sourcePdfState: "ready" | "pending" | "error" | "missing";
  translatedPdfState: "ready" | "pending" | "error" | "missing";
  pdfDownloadedBytes: number | null;
  pdfTotalBytes: number | null;
  translationBusy: boolean;
  translationDetail: string;
  onAnalyzePaper: (() => void) | null;
  onOpenLink: () => void;
  onCopyLink: () => void;
  t: TranslationFn;
}) {
  const {
    citation,
    activeLink,
    linkError,
    copyState,
    paperPreview,
    paperPreviewLoading,
    paperPreviewError,
    sourcePdfState,
    translatedPdfState,
    pdfDownloadedBytes,
    pdfTotalBytes,
    translationBusy,
    translationDetail,
    onAnalyzePaper,
    onOpenLink,
    onCopyLink,
    t,
  } = props;

  const progressPercent = pdfTotalBytes && pdfTotalBytes > 0
    ? Math.max(0, Math.min(100, ((pdfDownloadedBytes ?? 0) / pdfTotalBytes) * 100))
    : null;

  return (
    <aside className="grid min-h-0 gap-3 lg:grid-rows-[auto_auto_minmax(0,1fr)]">
      <section className="rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              {t("library.viewer.section.document")}
            </p>
            <h3 className="mt-1 text-sm font-semibold text-slate-900">
              {citation?.title || citation?.citationKey || t("library.detailTitle")}
            </h3>
          </div>
          <StatusPill label={statusLabel(sourcePdfState, t)} tone={statusTone(sourcePdfState)} />
        </div>
        <div className="mt-3 grid gap-2 text-xs text-slate-600">
          <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
            <span>{t("library.viewer.sourcePdf")}</span>
            <StatusPill label={statusLabel(sourcePdfState, t)} tone={statusTone(sourcePdfState)} />
          </div>
          <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
            <span>{t("library.viewer.translatedPdf")}</span>
            <StatusPill label={statusLabel(translatedPdfState, t)} tone={statusTone(translatedPdfState)} />
          </div>
          {sourcePdfState === "pending" ? (
            <div className="rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-2 text-[11px] text-sky-800">
              <div className="flex items-center gap-2">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                <span>{t("library.viewer.downloadingPdf")}</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sky-100">
                <div
                  className="h-full rounded-full bg-sky-500 transition-[width] duration-300"
                  style={{ width: `${progressPercent ?? 20}%` }}
                />
              </div>
              <div className="mt-2 text-[11px] text-sky-700">
                {pdfTotalBytes && pdfTotalBytes > 0
                  ? `${formatByteCount(pdfDownloadedBytes ?? 0)} / ${formatByteCount(pdfTotalBytes)}`
                  : formatByteCount(pdfDownloadedBytes ?? 0)}
              </div>
            </div>
          ) : null}
          {translationBusy || translationDetail ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px] text-slate-700">
              <div className="flex items-center gap-2 font-medium text-slate-800">
                <Languages className={`h-3.5 w-3.5 ${translationBusy ? "animate-pulse" : ""}`} />
                <span>{t("library.viewer.section.translation")}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-slate-600">
                {translationDetail || t("library.viewer.translating")}
              </p>
            </div>
          ) : null}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            {t("library.viewer.section.links")}
          </p>
          {activeLink ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-100"
                onClick={onOpenLink}
                title={t("library.viewer.openLink")}
              >
                <ExternalLink className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-100"
                onClick={onCopyLink}
                title={t("library.viewer.copyLink")}
              >
                {copyState ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
          ) : null}
        </div>
        <div className="mt-3 space-y-2 text-xs">
          {activeLink ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-slate-700">
              <div className="mb-1 text-[11px] font-medium text-slate-500">{t("library.viewer.remoteSource")}</div>
              <p className="break-all leading-5">{activeLink}</p>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-2.5 py-3 text-slate-500">
              {t("library.citation.none")}
            </div>
          )}
          {linkError ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2 text-rose-700">
              {linkError}
            </div>
          ) : null}
        </div>
      </section>

      <section className="min-h-0 overflow-auto rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            {t("library.viewer.section.reading")}
          </p>
          {onAnalyzePaper ? (
            <button
              type="button"
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 transition hover:bg-slate-100"
              onClick={onAnalyzePaper}
            >
              {t("library.viewer.analyzePaper")}
            </button>
          ) : null}
        </div>
        <div className="mt-3 space-y-3 text-xs text-slate-700">
          {paperPreviewLoading ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-3 text-slate-500">
              {t("library.viewer.paperBriefLoading")}
            </div>
          ) : paperPreviewError ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-3 text-amber-700">
              {t("library.viewer.paperBriefError")}
            </div>
          ) : paperPreview ? (
            <>
              {paperPreview.title ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
                  <p className="font-medium text-slate-900">{paperPreview.title}</p>
                </div>
              ) : null}
              <div className="grid gap-2 sm:grid-cols-2">
                {paperPreview.detectedLanguage ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
                    <div className="text-[11px] text-slate-500">{t("library.viewer.paperLanguage")}</div>
                    <div className="mt-1 font-medium text-slate-800">{paperPreview.detectedLanguage}</div>
                  </div>
                ) : null}
                {paperPreview.pageCount ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
                    <div className="text-[11px] text-slate-500">{t("library.viewer.paperPages")}</div>
                    <div className="mt-1 font-medium text-slate-800">{paperPreview.pageCount}</div>
                  </div>
                ) : null}
              </div>
              {paperPreview.extractionEngine ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
                  <div className="text-[11px] text-slate-500">{t("library.viewer.paperEngine")}</div>
                  <div className="mt-1 font-medium text-slate-800">{paperPreview.extractionEngine}</div>
                </div>
              ) : null}
              {paperPreview.excerpt ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
                  <div className="text-[11px] text-slate-500">{t("library.viewer.paperExcerpt")}</div>
                  <p className="mt-2 whitespace-pre-wrap break-words leading-5 text-slate-700">
                    {paperPreview.excerpt}
                  </p>
                </div>
              ) : null}
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-2.5 py-3 text-slate-500">
              {t("library.viewer.noBib")}
            </div>
          )}
        </div>
      </section>
    </aside>
  );
}
