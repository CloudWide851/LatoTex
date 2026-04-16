import { openExternalLink } from "../../../shared/api/app";
import type { ReactNode } from "react";
import type { LibraryCitationSummary } from "../../../shared/types/app";

type TranslationFn = (key: any) => string;

type PaperPreview = {
  title?: string | null;
  detectedLanguage?: string | null;
  extractionEngine?: string | null;
  pageCount?: number | null;
  excerpt?: string | null;
};

export function LibraryCitationMetaPanel(props: {
  citation: LibraryCitationSummary | null;
  linkError: string | null;
  paperPreview?: PaperPreview | null;
  paperPreviewLoading: boolean;
  paperPreviewError: string | null;
  onAnalyzePaper?: (() => void) | null;
  t: TranslationFn;
}) {
  const { citation, linkError, paperPreview, paperPreviewLoading, paperPreviewError, onAnalyzePaper, t } = props;
  const metadataRows = [
    citation?.title ? { label: t("library.citation.fieldTitle"), value: citation.title } : null,
    (citation?.authors.length ?? 0) > 0
      ? { label: t("library.citation.fieldAuthors"), value: citation?.authors.join(", ") }
      : null,
    citation?.publishedAt ? { label: t("library.citation.fieldPublishedAt"), value: citation.publishedAt } : null,
    citation?.citationKey
      ? { label: t("library.citation.key"), value: <span className="font-mono">{citation.citationKey}</span> }
      : null,
    citation?.doi ? { label: t("library.citation.fieldDoi"), value: citation.doi } : null,
    citation?.arxivId ? { label: t("library.citation.fieldArxiv"), value: citation.arxivId } : null,
  ].filter(Boolean) as Array<{ label: string; value: ReactNode }>;

  return (
    <section className="min-h-full rounded-xl border border-slate-200 bg-white p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          {t("library.viewer.metadataTab")}
        </h3>
        {onAnalyzePaper ? (
          <button
            className="rounded-md border border-slate-300 px-2 py-1 text-[11px] text-slate-700 transition hover:bg-slate-100"
            onClick={onAnalyzePaper}
          >
            {t("library.viewer.analyzePaper")}
          </button>
        ) : null}
      </div>

      <div className="space-y-3 text-xs">
        <section className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {t("library.viewer.paperBrief")}
          </div>
          {paperPreviewLoading ? (
            <p className="text-[11px] text-slate-500">{t("library.viewer.paperBriefLoading")}</p>
          ) : paperPreviewError ? (
            <p className="text-[11px] text-amber-600">{t("library.viewer.paperBriefError")}</p>
          ) : paperPreview ? (
            <div className="space-y-3 text-slate-700">
              {paperPreview.title ? <p className="break-words text-sm font-medium">{paperPreview.title}</p> : null}
              <div className="grid gap-2 sm:grid-cols-3">
                {paperPreview.detectedLanguage ? (
                  <div className="rounded-md border border-slate-200 bg-white px-2.5 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-slate-400">{t("library.viewer.paperLanguage")}</div>
                    <div className="mt-1 break-words text-[11px] text-slate-700">{paperPreview.detectedLanguage}</div>
                  </div>
                ) : null}
                {paperPreview.pageCount ? (
                  <div className="rounded-md border border-slate-200 bg-white px-2.5 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-slate-400">{t("library.viewer.paperPages")}</div>
                    <div className="mt-1 text-[11px] text-slate-700">{paperPreview.pageCount}</div>
                  </div>
                ) : null}
                {paperPreview.extractionEngine ? (
                  <div className="rounded-md border border-slate-200 bg-white px-2.5 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-slate-400">{t("library.viewer.paperEngine")}</div>
                    <div className="mt-1 break-words text-[11px] text-slate-700">{paperPreview.extractionEngine}</div>
                  </div>
                ) : null}
              </div>
              {paperPreview.excerpt ? (
                <div className="rounded-md border border-slate-200 bg-white px-3 py-2.5 text-[11px] leading-5 text-slate-600">
                  <div className="mb-1 font-semibold text-slate-500">{t("library.viewer.paperExcerpt")}</div>
                  <p className="line-clamp-6 whitespace-pre-wrap break-words">{paperPreview.excerpt}</p>
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-slate-300 bg-white px-3 py-2.5 text-[11px] leading-5 text-slate-500">
                  {t("library.viewer.paperExcerptUnavailable")}
                </div>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-slate-500">{t("library.viewer.paperExcerptUnavailable")}</p>
          )}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {t("library.viewer.metadataTab")}
          </div>
          <div className="divide-y divide-slate-100">
            {metadataRows.map((row) => (
              <div key={row.label} className="grid gap-1 px-3 py-2.5 sm:grid-cols-[140px_minmax(0,1fr)] sm:items-start">
                <div className="text-[11px] font-medium text-slate-500">{row.label}</div>
                <div className="break-words text-slate-700">{row.value}</div>
              </div>
            ))}
            {citation?.urls.length ? (
              <div className="grid gap-2 px-3 py-2.5 sm:grid-cols-[140px_minmax(0,1fr)] sm:items-start">
                <div className="text-[11px] font-medium text-slate-500">{t("library.citation.fieldUrl")}</div>
                <div className="space-y-1.5">
                  {citation.urls.map((url) => (
                    <a
                      key={url}
                      className="block break-all text-primary-700 underline"
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(event) => {
                        event.preventDefault();
                        void openExternalLink(url);
                      }}
                    >
                      {url}
                    </a>
                  ))}
                </div>
              </div>
            ) : null}
            {linkError ? (
              <div className="px-3 py-2.5 text-rose-600">{linkError}</div>
            ) : null}
          </div>
        </section>
      </div>
    </section>
  );
}
