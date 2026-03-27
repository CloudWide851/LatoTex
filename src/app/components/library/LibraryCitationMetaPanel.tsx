import { openExternalLink } from "../../../shared/api/app";
import type { LibraryCitationSummary } from "../../../shared/types/app";

type TranslationFn = (key: any) => string;

type PaperPreview = {
  title?: string | null;
  detectedLanguage?: string | null;
  extractionEngine?: string | null;
  pageCount?: number;
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

  return (
    <section className="min-h-0 overflow-auto rounded-lg border border-slate-200 bg-white p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {t("library.viewer.metadataTab")}
      </h3>
      <div className="space-y-2 rounded border border-slate-200 bg-slate-50 p-3 text-xs">
        {paperPreviewLoading || paperPreviewError || paperPreview ? (
          <div className="rounded border border-slate-200 bg-white p-3 text-slate-700">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {t("library.viewer.paperBrief")}
              </span>
              {onAnalyzePaper ? (
                <button
                  className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-100"
                  onClick={onAnalyzePaper}
                >
                  {t("library.viewer.analyzePaper")}
                </button>
              ) : null}
            </div>
            {paperPreviewLoading ? (
              <p className="text-[11px] text-slate-500">{t("library.viewer.paperBriefLoading")}</p>
            ) : paperPreviewError ? (
              <p className="text-[11px] text-amber-600">{t("library.viewer.paperBriefError")}</p>
            ) : paperPreview ? (
              <>
                {paperPreview.title ? <p className="mb-2 break-words font-medium">{paperPreview.title}</p> : null}
                <div className="grid gap-1 text-[11px] text-slate-600">
                  {paperPreview.detectedLanguage ? (
                    <p>{t("library.viewer.paperLanguage")}: {paperPreview.detectedLanguage}</p>
                  ) : null}
                  {paperPreview.pageCount ? (
                    <p>{t("library.viewer.paperPages")}: {paperPreview.pageCount}</p>
                  ) : null}
                  {paperPreview.extractionEngine ? (
                    <p>{t("library.viewer.paperEngine")}: {paperPreview.extractionEngine}</p>
                  ) : null}
                </div>
                {paperPreview.excerpt ? (
                  <div className="mt-2 rounded border border-slate-200 bg-slate-50 p-2 text-[11px] leading-5 text-slate-600">
                    <div className="mb-1 font-semibold text-slate-500">{t("library.viewer.paperExcerpt")}</div>
                    <p className="line-clamp-6 whitespace-pre-wrap break-words">{paperPreview.excerpt}</p>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
        {citation?.title ? (
          <p className="break-words text-slate-700">
            {t("library.citation.fieldTitle")}: {citation.title}
          </p>
        ) : null}
        {(citation?.authors.length ?? 0) > 0 ? (
          <p className="break-words text-slate-700">
            {t("library.citation.fieldAuthors")}: {citation?.authors.join(", ")}
          </p>
        ) : null}
        {citation?.publishedAt ? (
          <p className="break-words text-slate-700">
            {t("library.citation.fieldPublishedAt")}: {citation.publishedAt}
          </p>
        ) : null}
        {citation?.citationKey ? (
          <p className="break-words text-slate-700">
            {t("library.citation.key")}: <span className="font-mono">{citation.citationKey}</span>
          </p>
        ) : null}
        {citation?.doi ? (
          <p className="break-words text-slate-700">
            {t("library.citation.fieldDoi")}: {citation.doi}
          </p>
        ) : null}
        {citation?.arxivId ? (
          <p className="break-words text-slate-700">
            {t("library.citation.fieldArxiv")}: {citation.arxivId}
          </p>
        ) : null}
        {citation?.urls.length ? (
          <div className="space-y-1">
            <p className="text-slate-700">{t("library.citation.fieldUrl")}:</p>
            <ul className="space-y-1">
              {citation.urls.map((url) => (
                <li key={url}>
                  <a
                    className="break-all text-primary-700 underline"
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
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {linkError ? <p className="text-rose-600">{linkError}</p> : null}
      </div>
    </section>
  );
}