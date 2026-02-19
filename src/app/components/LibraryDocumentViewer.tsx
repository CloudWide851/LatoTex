import { ExternalLink, Link2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  libraryCitationSummary,
  openExternalLink,
  readFile,
  readFileBinary,
} from "../../shared/api/desktop";
import type { LibraryCitationSummary } from "../../shared/types/app";
import { isPdfPath } from "../../shared/utils/fileKind";
import { toLibraryWorkspacePath } from "../../shared/utils/libraryPath";

type TranslationFn = (key: any) => string;

function filenameFromPath(path: string | null): string {
  if (!path) {
    return "";
  }
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

function previewMode(path: string | null): "pdf" | "text" | "unsupported" {
  if (!path) {
    return "unsupported";
  }
  if (isPdfPath(path)) {
    return "pdf";
  }
  const lower = path.toLowerCase();
  if (
    lower.endsWith(".bib") ||
    lower.endsWith(".txt") ||
    lower.endsWith(".md") ||
    lower.endsWith(".markdown")
  ) {
    return "text";
  }
  return "unsupported";
}

export function LibraryDocumentViewer(props: {
  projectId: string | null;
  selectedPath: string | null;
  t: TranslationFn;
}) {
  const { projectId, selectedPath, t } = props;
  const [loading, setLoading] = useState(false);
  const [textPreview, setTextPreview] = useState("");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [citation, setCitation] = useState<LibraryCitationSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [viewerTab, setViewerTab] = useState<"preview" | "metadata">("preview");
  const [showLinks, setShowLinks] = useState(false);
  const mode = useMemo(() => previewMode(selectedPath), [selectedPath]);

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
      setTextPreview("");
      setCitation(null);
      setViewerTab("preview");
      setShowLinks(false);
      setLinkError(null);
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
    setShowLinks(false);
    setViewerTab("preview");
    const workspacePath = toLibraryWorkspacePath(selectedPath);

    const loadPreview = async () => {
      if (mode === "pdf") {
        const binary = await readFileBinary(projectId, workspacePath);
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
        setTextPreview("");
      } else if (mode === "text") {
        const result = await readFile(projectId, workspacePath);
        if (cancelled) {
          return;
        }
        setTextPreview(result.content);
        setPdfUrl((prev) => {
          if (prev) {
            URL.revokeObjectURL(prev);
          }
          return null;
        });
      } else {
        setTextPreview("");
        setPdfUrl((prev) => {
          if (prev) {
            URL.revokeObjectURL(prev);
          }
          return null;
        });
      }
    };

    const loadCitation = async () => {
      const result = await libraryCitationSummary(projectId, selectedPath);
      if (!cancelled) {
        setCitation({
          ...result,
          authors: result.authors ?? [],
          urls: result.urls ?? [],
        });
      }
    };

    Promise.all([loadPreview(), loadCitation()])
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
  }, [mode, projectId, selectedPath]);

  const handleOpenLink = async (url: string) => {
    setLinkError(null);
    try {
      await openExternalLink(url);
    } catch (error) {
      if (typeof window !== "undefined") {
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        setLinkError(`${t("library.viewer.linkOpenFailed")} ${String(error)}`);
      }
    }
  };

  if (!selectedPath) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500">
        {t("library.noSelection")}
      </div>
    );
  }

  const hasLinks = (citation?.urls.length ?? 0) > 0;
  const hasCitation =
    hasLinks ||
    Boolean(citation?.citationKey) ||
    Boolean(citation?.title) ||
    Boolean(citation?.doi) ||
    Boolean(citation?.arxivId) ||
    Boolean(citation?.publishedAt) ||
    Boolean(citation?.source) ||
    (citation?.authors.length ?? 0) > 0;

  return (
    <div className="relative h-full min-h-0 overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex h-10 items-center justify-between border-b border-slate-200 px-3">
        <span className="truncate text-sm font-medium text-slate-700">{filenameFromPath(selectedPath)}</span>
        <div className="flex items-center gap-1">
          <button
            className={`rounded border px-2 py-1 text-[11px] ${
              viewerTab === "preview"
                ? "border-primary-300 bg-primary-50 text-primary-800"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
            }`}
            onClick={() => setViewerTab("preview")}
            title={t("library.viewer.previewTab")}
          >
            {t("library.viewer.previewTab")}
          </button>
          <button
            className={`rounded border px-2 py-1 text-[11px] ${
              viewerTab === "metadata"
                ? "border-primary-300 bg-primary-50 text-primary-800"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
            }`}
            onClick={() => setViewerTab("metadata")}
            title={t("library.viewer.metadataTab")}
          >
            {t("library.viewer.metadataTab")}
          </button>
          <button
            className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-100 disabled:opacity-40"
            onClick={() => setShowLinks((prev) => !prev)}
            disabled={!hasLinks}
            title={t("library.citation.linksButton")}
            aria-label={t("library.citation.linksButton")}
          >
            <Link2 className="h-3.5 w-3.5" />
            <span>{t("library.citation.linksButton")}</span>
          </button>
        </div>
      </div>

      <div className="h-[calc(100%-40px)] overflow-auto p-3">
        {loading ? (
          <div className="flex h-full items-center justify-center text-xs text-slate-500">
            {t("library.viewer.loading")}
          </div>
        ) : loadError ? (
          <div className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {t("library.viewer.error")} {loadError}
          </div>
        ) : viewerTab === "metadata" ? (
          <div className="space-y-3">
            {!hasCitation ? (
              <div className="rounded border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                {t("library.citation.none")}
              </div>
            ) : (
              <div className="space-y-2 rounded border border-slate-200 bg-slate-50 p-3 text-xs">
                {citation?.title && (
                  <p className="break-words text-slate-700">
                    {t("library.citation.fieldTitle")}: {citation.title}
                  </p>
                )}
                {(citation?.authors.length ?? 0) > 0 && (
                  <p className="break-words text-slate-700">
                    {t("library.citation.fieldAuthors")}: {citation?.authors.join(", ")}
                  </p>
                )}
                {citation?.publishedAt && (
                  <p className="break-words text-slate-700">
                    {t("library.citation.fieldPublishedAt")}: {citation.publishedAt}
                  </p>
                )}
                {citation?.citationKey && (
                  <p className="break-words text-slate-700">
                    {t("library.citation.key")}: <span className="font-mono">{citation.citationKey}</span>
                  </p>
                )}
                {citation?.doi && (
                  <p className="break-words text-slate-700">
                    {t("library.citation.fieldDoi")}: {citation.doi}
                  </p>
                )}
                {citation?.arxivId && (
                  <p className="break-words text-slate-700">
                    {t("library.citation.fieldArxiv")}: {citation.arxivId}
                  </p>
                )}
                {citation?.bibPath && (
                  <p className="break-words text-slate-700">
                    {t("library.citation.fieldBibPath")}: {citation.bibPath}
                  </p>
                )}
                {citation?.source && (
                  <p className="break-words text-slate-700">
                    {t("library.citation.fieldSource")}: {citation.source}
                  </p>
                )}
              </div>
            )}
            {showLinks ? (
              hasLinks ? (
                <div className="space-y-1 rounded border border-slate-200 bg-white p-2">
                  {(citation?.urls ?? []).map((url) => (
                    <button
                      key={url}
                      className="inline-flex w-full items-center justify-between gap-2 rounded border border-slate-300 bg-slate-50 px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100"
                      onClick={() => {
                        void handleOpenLink(url);
                      }}
                      title={url}
                    >
                      <span className="truncate">{url}</span>
                      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="rounded border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  {t("library.citation.none")}
                </div>
              )
            ) : null}
            {linkError ? (
              <div className="rounded border border-rose-300 bg-rose-50 px-2 py-1 text-xs text-rose-700">
                {linkError}
              </div>
            ) : null}
          </div>
        ) : mode === "pdf" && pdfUrl ? (
          <iframe title={filenameFromPath(selectedPath)} src={pdfUrl} className="h-full w-full rounded border border-slate-200" />
        ) : mode === "text" ? (
          <pre className="min-h-full whitespace-pre-wrap break-words rounded border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-5 text-slate-700">
            {textPreview}
          </pre>
        ) : (
          <div className="flex h-full items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500">
            {t("library.viewer.unsupported")}
          </div>
        )}
      </div>
    </div>
  );
}
