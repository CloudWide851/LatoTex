import { ExternalLink, Link2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  libraryCitationSummary,
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
  const [citationOpen, setCitationOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
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
      setCitationOpen(false);
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
    setCitationOpen(false);
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
        setCitation(result);
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

  if (!selectedPath) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500">
        {t("library.noSelection")}
      </div>
    );
  }

  const hasCitation =
    (citation?.urls.length ?? 0) > 0 ||
    Boolean(citation?.citationKey) ||
    Boolean(citation?.title) ||
    Boolean(citation?.doi) ||
    Boolean(citation?.arxivId);

  return (
    <div className="relative h-full min-h-0 overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex h-10 items-center justify-between border-b border-slate-200 px-3">
        <span className="truncate text-sm font-medium text-slate-700">{filenameFromPath(selectedPath)}</span>
      </div>

      <button
        className="absolute right-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-100"
        title={t("library.citation.ball")}
        aria-label={t("library.citation.ball")}
        onClick={() => setCitationOpen((prev) => !prev)}
      >
        <Link2 className="h-4 w-4" />
      </button>

      {citationOpen && (
        <div className="absolute right-3 top-12 z-20 w-80 max-w-[calc(100%-24px)] rounded-lg border border-slate-300 bg-white p-3 shadow-lg">
          <h4 className="mb-2 text-xs font-semibold text-slate-700">{t("library.citation.title")}</h4>
          {!hasCitation ? (
            <p className="text-xs text-slate-500">{t("library.citation.none")}</p>
          ) : (
            <div className="space-y-2 text-xs">
              {(citation?.urls.length ?? 0) > 0 && (
                <div>
                  <p className="mb-1 font-semibold text-slate-700">{t("library.citation.urls")}</p>
                  <ul className="space-y-1">
                    {(citation?.urls ?? []).map((url) => (
                      <li key={url}>
                        <a
                          className="inline-flex items-center gap-1 break-all text-primary-700 underline hover:text-primary-600"
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <span>{url}</span>
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="space-y-1 rounded border border-slate-200 bg-slate-50 p-2">
                {citation?.citationKey && (
                  <p className="break-all text-slate-700">
                    {t("library.citation.key")}: <span className="font-mono">{citation.citationKey}</span>
                  </p>
                )}
                {citation?.title && (
                  <p className="break-all text-slate-700">
                    {t("library.citation.fieldTitle")}: {citation.title}
                  </p>
                )}
                {citation?.doi && (
                  <p className="break-all text-slate-700">
                    {t("library.citation.fieldDoi")}: {citation.doi}
                  </p>
                )}
                {citation?.arxivId && (
                  <p className="break-all text-slate-700">
                    {t("library.citation.fieldArxiv")}: {citation.arxivId}
                  </p>
                )}
                {citation?.bibPath && (
                  <p className="break-all text-slate-700">
                    {t("library.citation.fieldBibPath")}: {citation.bibPath}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="h-[calc(100%-40px)] overflow-auto p-3">
        {loading ? (
          <div className="flex h-full items-center justify-center text-xs text-slate-500">
            {t("library.viewer.loading")}
          </div>
        ) : loadError ? (
          <div className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {t("library.viewer.error")} {loadError}
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

