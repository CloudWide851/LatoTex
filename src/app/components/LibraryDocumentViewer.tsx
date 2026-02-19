import { Copy, ExternalLink, FileText, FileUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  libraryCitationSummary,
  libraryResolvePdfPreview,
  openExternalLink,
  readFile,
  readFileBinary,
} from "../../shared/api/desktop";
import type { LibraryCitationSummary } from "../../shared/types/app";
import { toLibraryWorkspacePath } from "../../shared/utils/libraryPath";

type TranslationFn = (key: any) => string;

function filenameFromPath(path: string | null): string {
  if (!path) {
    return "";
  }
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

export function LibraryDocumentViewer(props: {
  projectId: string | null;
  selectedPath: string | null;
  t: TranslationFn;
}) {
  const { projectId, selectedPath, t } = props;
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState(false);
  const [citation, setCitation] = useState<LibraryCitationSummary | null>(null);
  const [bibPreview, setBibPreview] = useState("");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [resolvedLink, setResolvedLink] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"bib" | "pdf">("bib");

  const hasPdf = Boolean(pdfUrl);
  const hasBib = bibPreview.trim().length > 0;
  const hasLinks = (citation?.urls.length ?? 0) > 0 || Boolean(resolvedLink);
  const activeLink = useMemo(
    () => resolvedLink ?? citation?.urls?.[0] ?? null,
    [citation?.urls, resolvedLink],
  );

  useEffect(() => {
    return () => {
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
      }
    };
  }, [pdfUrl]);

  useEffect(() => {
    let cancelled = false;
    if (!projectId || !selectedPath) {
      setLoadError(null);
      setLinkError(null);
      setCopyState(false);
      setCitation(null);
      setBibPreview("");
      setResolvedLink(null);
      setViewMode("bib");
      setPdfUrl((prev) => {
        if (prev) {
          URL.revokeObjectURL(prev);
        }
        return null;
      });
      return;
    }

    setLoading(true);
    setLoadError(null);
    setLinkError(null);
    setCopyState(false);
    setViewMode("bib");

    const load = async () => {
      const summary = await libraryCitationSummary(projectId, selectedPath);
      if (cancelled) {
        return;
      }
      setCitation({
        ...summary,
        authors: summary.authors ?? [],
        urls: summary.urls ?? [],
      });

      const bibRelative = summary.bibPath ?? (selectedPath.toLowerCase().endsWith(".bib") ? selectedPath : "");
      if (bibRelative) {
        const bibResult = await readFile(projectId, toLibraryWorkspacePath(bibRelative));
        if (!cancelled) {
          setBibPreview(bibResult.content);
        }
      } else if (!cancelled) {
        setBibPreview("");
      }

      const pdfPreview = await libraryResolvePdfPreview(projectId, selectedPath);
      if (cancelled) {
        return;
      }
      setResolvedLink(pdfPreview.sourceUrl ?? summary.urls?.[0] ?? null);
      if (pdfPreview.relativePath) {
        const binary = await readFileBinary(projectId, pdfPreview.relativePath);
        if (cancelled) {
          return;
        }
        const nextUrl = URL.createObjectURL(
          new Blob([Uint8Array.from(binary.bytes)], { type: "application/pdf" }),
        );
        setPdfUrl((prev) => {
          if (prev) {
            URL.revokeObjectURL(prev);
          }
          return nextUrl;
        });
      } else {
        setPdfUrl((prev) => {
          if (prev) {
            URL.revokeObjectURL(prev);
          }
          return null;
        });
      }
    };

    load()
      .catch((error) => {
        if (!cancelled) {
          setLoadError(String(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, selectedPath]);

  const handleOpenLink = async () => {
    if (!activeLink) {
      return;
    }
    setLinkError(null);
    try {
      await openExternalLink(activeLink);
    } catch {
      setLinkError(t("library.viewer.linkOpenFailed"));
    }
  };

  const handleCopyLink = async () => {
    if (!activeLink || typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }
    await navigator.clipboard.writeText(activeLink);
    setCopyState(true);
    window.setTimeout(() => setCopyState(false), 1400);
  };

  if (!selectedPath) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500">
        {t("library.noSelection")}
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_minmax(210px,0.95fr)] gap-2">
      <section className="grid min-h-0 grid-rows-[40px_minmax(0,1fr)] overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-3">
          <div className="flex min-w-0 items-center gap-2">
            <FileText className="h-3.5 w-3.5 text-slate-500" />
            <span className="truncate text-sm font-medium text-slate-700">{filenameFromPath(selectedPath)}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              className={`rounded border px-2 py-1 text-[11px] ${
                viewMode === "bib"
                  ? "border-primary-300 bg-primary-50 text-primary-900"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
              }`}
              onClick={() => setViewMode("bib")}
              title={t("library.viewer.showBib")}
            >
              {t("library.viewer.showBib")}
            </button>
            <button
              className={`rounded border px-2 py-1 text-[11px] ${
                viewMode === "pdf"
                  ? "border-primary-300 bg-primary-50 text-primary-900"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
              }`}
              onClick={() => setViewMode("pdf")}
              title={t("library.viewer.showPdf")}
              disabled={!hasPdf}
            >
              {t("library.viewer.showPdf")}
            </button>
            <button
              className="rounded border border-slate-300 bg-white p-1.5 text-slate-700 hover:bg-slate-100 disabled:opacity-40"
              onClick={() => void handleOpenLink()}
              disabled={!activeLink}
              title={t("library.viewer.openLink")}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
            <button
              className="rounded border border-slate-300 bg-white p-1.5 text-slate-700 hover:bg-slate-100 disabled:opacity-40"
              onClick={() => void handleCopyLink()}
              disabled={!activeLink}
              title={copyState ? t("library.viewer.copySuccess") : t("library.viewer.copyLink")}
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="min-h-0 overflow-auto p-3">
          {loading ? (
            <div className="flex h-full items-center justify-center text-xs text-slate-500">
              {t("library.viewer.loading")}
            </div>
          ) : loadError ? (
            <div className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {t("library.viewer.error")} {loadError}
            </div>
          ) : viewMode === "pdf" ? (
            hasPdf && pdfUrl ? (
              <iframe
                title={filenameFromPath(selectedPath)}
                src={pdfUrl}
                className="h-full w-full rounded border border-slate-200"
              />
            ) : (
              <div className="flex h-full items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500">
                <FileUp className="mr-2 h-3.5 w-3.5" />
                {t("library.viewer.noPdf")}
              </div>
            )
          ) : hasBib ? (
            <pre className="min-h-full whitespace-pre-wrap break-words rounded border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-5 text-slate-700">
              {bibPreview}
            </pre>
          ) : (
            <div className="flex h-full items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500">
              {t("library.viewer.noBib")}
            </div>
          )}
        </div>
      </section>

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
          {citation?.source ? (
            <p className="break-words text-slate-700">
              {t("library.citation.fieldSource")}: {citation.source}
            </p>
          ) : null}
          {activeLink ? (
            <p className="break-all text-slate-700">
              {t("library.citation.urls")}: {activeLink}
            </p>
          ) : hasLinks ? (
            <p className="text-slate-500">{t("library.citation.urls")}: -</p>
          ) : null}
          {linkError && activeLink ? (
            <div className="space-y-1 rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
              <p>{t("library.viewer.linkFallback")}</p>
              <p className="break-all font-mono">{activeLink}</p>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
