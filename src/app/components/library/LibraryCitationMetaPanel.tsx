import { openExternalLink } from "../../../shared/api/desktop";
import type { LibraryCitationSummary } from "../../../shared/types/app";

type TranslationFn = (key: any) => string;

export function LibraryCitationMetaPanel(props: {
  citation: LibraryCitationSummary | null;
  linkError: string | null;
  t: TranslationFn;
}) {
  const { citation, linkError, t } = props;

  return (
    <section className="min-h-0 overflow-auto rounded-lg border border-slate-200 bg-white p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {t("library.viewer.metadataTab")}
      </h3>
      <div className="space-y-2 rounded border border-slate-200 bg-slate-50 p-3 text-xs">
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
