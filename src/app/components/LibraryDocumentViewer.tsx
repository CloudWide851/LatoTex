import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  FileUp,
  Highlighter,
  Minus,
  Plus,
  Type,
  Undo2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  libraryCitationSummary,
  libraryResolvePdfPreview,
  openExternalLink,
  readFile,
  readFileBinary,
  writeFile,
} from "../../shared/api/desktop";
import type { LibraryCitationSummary } from "../../shared/types/app";
import { toLibraryWorkspacePath } from "../../shared/utils/libraryPath";
import { PdfAnnotationLayer } from "./library/PdfAnnotationLayer";
import {
  parseAnnotationPayload,
  toLibraryAnnotationPath,
  type AnnotationPayload,
  type AnnotationStroke,
  type AnnotationTextBox,
} from "./library/annotationModel";

type TranslationFn = (key: any) => string;

function filenameFromPath(path: string | null): string {
  if (!path) {
    return "";
  }
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

function buildPdfSrc(pdfUrl: string, page: number, zoom: number): string {
  const normalizedPage = Math.max(1, Math.floor(page));
  const normalizedZoom = Math.max(40, Math.min(300, Math.round(zoom * 100)));
  return `${pdfUrl}#page=${normalizedPage}&zoom=${normalizedZoom}`;
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
  const [annotationEnabled, setAnnotationEnabled] = useState(false);
  const [textBoxMode, setTextBoxMode] = useState(false);
  const [annotationStrokes, setAnnotationStrokes] = useState<AnnotationStroke[]>([]);
  const [annotationTextBoxes, setAnnotationTextBoxes] = useState<AnnotationTextBox[]>([]);
  const [annotationLoaded, setAnnotationLoaded] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [pdfZoom, setPdfZoom] = useState(1);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const hasPdf = Boolean(pdfUrl);
  const hasBib = bibPreview.trim().length > 0;
  const activeLink = useMemo(
    () => resolvedLink ?? citation?.urls?.[0] ?? null,
    [citation?.urls, resolvedLink],
  );
  const annotationPath = useMemo(
    () => (selectedPath ? toLibraryAnnotationPath(selectedPath) : null),
    [selectedPath],
  );
  const pageStrokeCount = useMemo(
    () => annotationStrokes.filter((item) => item.page === currentPage).length,
    [annotationStrokes, currentPage],
  );
  const pageTextBoxCount = useMemo(
    () => annotationTextBoxes.filter((item) => item.page === currentPage).length,
    [annotationTextBoxes, currentPage],
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
      setAnnotationEnabled(false);
      setTextBoxMode(false);
      setAnnotationStrokes([]);
      setAnnotationTextBoxes([]);
      setCurrentPage(1);
      setPageInput("1");
      setPdfZoom(1);
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
    setAnnotationEnabled(false);
    setTextBoxMode(false);
    setCurrentPage(1);
    setPageInput("1");
    setPdfZoom(1);

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

  useEffect(() => {
    let disposed = false;
    if (!projectId || !annotationPath) {
      setAnnotationLoaded(false);
      setAnnotationStrokes([]);
      setAnnotationTextBoxes([]);
      return;
    }
    setAnnotationLoaded(false);
    setAnnotationStrokes([]);
    setAnnotationTextBoxes([]);

    void readFile(projectId, annotationPath)
      .then((result) => {
        if (disposed) {
          return;
        }
        const parsed = parseAnnotationPayload(result.content);
        setAnnotationStrokes(parsed.strokes);
        setAnnotationTextBoxes(parsed.textBoxes);
      })
      .catch(() => {
        if (!disposed) {
          setAnnotationStrokes([]);
          setAnnotationTextBoxes([]);
        }
      })
      .finally(() => {
        if (!disposed) {
          setAnnotationLoaded(true);
        }
      });

    return () => {
      disposed = true;
    };
  }, [annotationPath, projectId]);

  useEffect(() => {
    if (!annotationLoaded || !projectId || !annotationPath) {
      return;
    }
    const timer = window.setTimeout(() => {
      const payload: AnnotationPayload = {
        version: 2,
        strokes: annotationStrokes,
        textBoxes: annotationTextBoxes,
      };
      void writeFile(projectId, annotationPath, JSON.stringify(payload, null, 2));
    }, 180);
    return () => {
      window.clearTimeout(timer);
    };
  }, [annotationLoaded, annotationPath, annotationStrokes, annotationTextBoxes, projectId]);

  useEffect(() => {
    if (viewMode !== "pdf" || !hasPdf) {
      setAnnotationEnabled(false);
      setTextBoxMode(false);
    }
  }, [hasPdf, viewMode]);

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
    try {
      await navigator.clipboard.writeText(activeLink);
      setCopyState(true);
      window.setTimeout(() => setCopyState(false), 1400);
    } catch {
      setLinkError(t("library.viewer.linkOpenFailed"));
    }
  };

  const jumpToPage = useCallback((next: number) => {
    const normalized = Math.max(1, Math.floor(next));
    setCurrentPage(normalized);
    setPageInput(String(normalized));
  }, []);

  if (!selectedPath) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500">
        {t("library.noSelection")}
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 grid-rows-[40px_minmax(0,1fr)] gap-2">
      <section className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3">
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="h-3.5 w-3.5 text-slate-500" />
          <span className="truncate text-sm font-medium text-slate-700">{filenameFromPath(selectedPath)}</span>
        </div>
        <div className="flex min-w-0 flex-nowrap items-center gap-1 overflow-x-auto py-1">
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
          {viewMode === "pdf" ? (
            <>
              <button
                className={`rounded border p-1.5 text-slate-600 transition disabled:opacity-40 ${
                  annotationEnabled
                    ? "border-primary-600 bg-primary-600 text-white hover:bg-primary-700"
                    : "border-slate-300 bg-white hover:bg-slate-100"
                }`}
                title={annotationEnabled ? t("preview.annotationDisable") : t("preview.annotationEnable")}
                aria-label={annotationEnabled ? t("preview.annotationDisable") : t("preview.annotationEnable")}
                onClick={() => {
                  setAnnotationEnabled((prev) => !prev);
                  setTextBoxMode(false);
                }}
                disabled={!hasPdf}
              >
                <Highlighter className="h-3.5 w-3.5" />
              </button>
              <button
                className={`rounded border p-1.5 text-slate-600 transition disabled:opacity-40 ${
                  textBoxMode
                    ? "border-primary-600 bg-primary-600 text-white hover:bg-primary-700"
                    : "border-slate-300 bg-white hover:bg-slate-100"
                }`}
                title={t("library.viewer.textboxMode")}
                aria-label={t("library.viewer.textboxMode")}
                onClick={() => {
                  setTextBoxMode((prev) => !prev);
                  setAnnotationEnabled(false);
                }}
                disabled={!hasPdf}
              >
                <Type className="h-3.5 w-3.5" />
              </button>
              <button
                className="rounded border border-slate-300 bg-white p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                title={t("preview.annotationUndo")}
                aria-label={t("preview.annotationUndo")}
                onClick={() =>
                  setAnnotationStrokes((items) => {
                    const pageItems = items.filter((item) => item.page === currentPage);
                    if (pageItems.length === 0) {
                      return items;
                    }
                    const lastId = pageItems[pageItems.length - 1].id;
                    return items.filter((item) => item.id !== lastId);
                  })
                }
                disabled={!hasPdf || pageStrokeCount === 0}
              >
                <Undo2 className="h-3.5 w-3.5" />
              </button>
              <button
                className="rounded border border-slate-300 bg-white p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                title={t("preview.annotationClear")}
                aria-label={t("preview.annotationClear")}
                onClick={() => {
                  setAnnotationStrokes((items) => items.filter((item) => item.page !== currentPage));
                  setAnnotationTextBoxes((items) => items.filter((item) => item.page !== currentPage));
                }}
                disabled={!hasPdf || (pageStrokeCount === 0 && pageTextBoxCount === 0)}
              >
                <Check className="h-3.5 w-3.5" />
              </button>
              <div className="ml-1 inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-1 py-0.5">
                <button
                  className="rounded p-1 text-slate-600 hover:bg-slate-100"
                  onClick={() => jumpToPage(currentPage - 1)}
                  title={t("library.viewer.prevPage")}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <input
                  className="w-10 rounded border border-slate-300 px-1 py-0.5 text-center text-[11px] text-slate-700"
                  value={pageInput}
                  onChange={(event) => setPageInput(event.target.value)}
                  onBlur={() => {
                    const parsed = Number(pageInput);
                    if (Number.isFinite(parsed)) {
                      jumpToPage(parsed);
                    } else {
                      setPageInput(String(currentPage));
                    }
                  }}
                  title={t("library.viewer.pageInput")}
                />
                <button
                  className="rounded p-1 text-slate-600 hover:bg-slate-100"
                  onClick={() => jumpToPage(currentPage + 1)}
                  title={t("library.viewer.nextPage")}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-1 py-0.5">
                <button
                  className="rounded p-1 text-slate-600 hover:bg-slate-100"
                  onClick={() => setPdfZoom((prev) => Math.max(0.6, Number((prev - 0.1).toFixed(2))))}
                  title={t("preview.zoomOut")}
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <span className="text-[11px] text-slate-600">{Math.round(pdfZoom * 100)}%</span>
                <button
                  className="rounded p-1 text-slate-600 hover:bg-slate-100"
                  onClick={() => setPdfZoom((prev) => Math.min(2.6, Number((prev + 0.1).toFixed(2))))}
                  title={t("preview.zoomIn")}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
              <button
                className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                onClick={() => void handleOpenLink()}
                disabled={!activeLink}
                title={t("library.viewer.openLink")}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span>{t("library.viewer.openLink")}</span>
              </button>
              <button
                className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                onClick={() => void handleCopyLink()}
                disabled={!activeLink}
                title={copyState ? t("library.viewer.copySuccess") : t("library.viewer.copyLink")}
              >
                {copyState ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copyState ? t("library.viewer.copySuccess") : t("library.viewer.copyLink")}</span>
              </button>
            </>
          ) : null}
        </div>
      </section>

      {viewMode === "pdf" ? (
        <section className="grid min-h-0 grid-rows-[minmax(0,1fr)] overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="min-h-0 overflow-auto p-3">
            {loading ? (
              <div className="flex h-full items-center justify-center text-xs text-slate-500">
                {t("library.viewer.loading")}
              </div>
            ) : loadError ? (
              <div className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {t("library.viewer.error")} {loadError}
              </div>
            ) : hasPdf && pdfUrl ? (
              <div
                ref={viewportRef}
                className={`relative h-full overflow-hidden rounded border border-slate-200 bg-slate-50 ${
                  annotationEnabled || textBoxMode ? "cursor-crosshair" : "cursor-default"
                }`}
              >
                <iframe
                  title={filenameFromPath(selectedPath)}
                  src={buildPdfSrc(pdfUrl, currentPage, pdfZoom)}
                  className="h-full w-full"
                  style={{ pointerEvents: annotationEnabled || textBoxMode ? "none" : "auto" }}
                />
                <PdfAnnotationLayer
                  page={currentPage}
                  viewportRef={viewportRef}
                  drawEnabled={annotationEnabled}
                  textBoxMode={textBoxMode}
                  strokes={annotationStrokes}
                  textBoxes={annotationTextBoxes}
                  onStrokesChange={setAnnotationStrokes}
                  onTextBoxesChange={setAnnotationTextBoxes}
                  t={t}
                />
              </div>
            ) : (
              <div className="flex h-full items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500">
                <FileUp className="mr-2 h-3.5 w-3.5" />
                {t("library.viewer.noPdf")}
              </div>
            )}
          </div>
        </section>
      ) : (
        <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_minmax(210px,0.95fr)] gap-2">
          <section className="min-h-0 overflow-auto rounded-lg border border-slate-200 bg-white p-3">
            {loading ? (
              <div className="flex h-full items-center justify-center text-xs text-slate-500">
                {t("library.viewer.loading")}
              </div>
            ) : loadError ? (
              <div className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {t("library.viewer.error")} {loadError}
              </div>
            ) : hasBib ? (
              <pre className="min-h-full whitespace-pre-wrap break-words rounded border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-5 text-slate-700">
                {bibPreview}
              </pre>
            ) : (
              <div className="flex h-full items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500">
                {t("library.viewer.noBib")}
              </div>
            )}
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
                <p className="break-words text-slate-700">
                  {t("library.citation.urls")}: {activeLink}
                </p>
              ) : (
                <p className="text-slate-500">{t("library.citation.urls")}: -</p>
              )}
              {linkError ? (
                <div className="rounded border border-amber-300 bg-amber-50 p-2 text-amber-700">
                  <p>{t("library.viewer.linkFallback")}</p>
                  {activeLink ? <p className="mt-1 break-words font-mono">{activeLink}</p> : null}
                </div>
              ) : null}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
