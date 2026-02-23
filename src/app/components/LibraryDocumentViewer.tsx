import { Check, Copy, ExternalLink, FileText, FileUp, Highlighter, Trash2, Undo2 } from "lucide-react";
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

type TranslationFn = (key: any) => string;

type AnnotationPoint = {
  x: number;
  y: number;
};

type AnnotationStroke = {
  id: string;
  points: AnnotationPoint[];
};

type AnnotationPayload = {
  version: 1;
  strokes: AnnotationStroke[];
};

function filenameFromPath(path: string | null): string {
  if (!path) {
    return "";
  }
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

function toLibraryAnnotationPath(selectedPath: string): string {
  const normalized = selectedPath.trim().toLowerCase();
  const safe = normalized
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96) || "library";
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const digest = (hash >>> 0).toString(16).padStart(8, "0");
  return `.latotex/papers/.annotations/${safe}-${digest}.json`;
}

function clampPointToView(x: number, y: number, width: number, height: number): AnnotationPoint {
  if (width <= 0 || height <= 0) {
    return { x: 0, y: 0 };
  }
  return {
    x: Math.max(0, Math.min(1000, Number(((x / width) * 1000).toFixed(2)))),
    y: Math.max(0, Math.min(1000, Number(((y / height) * 1000).toFixed(2)))),
  };
}

function parseAnnotationPayload(content: string): AnnotationStroke[] {
  try {
    const parsed = JSON.parse(content) as Partial<AnnotationPayload>;
    if (!Array.isArray(parsed?.strokes)) {
      return [];
    }
    return parsed.strokes
      .filter((item) => Array.isArray(item?.points) && item.points.length > 1)
      .map((item, index) => ({
        id: typeof item.id === "string" && item.id.length > 0 ? item.id : `stroke-${index}`,
        points: item.points
          .map((point) => ({
            x: Number(point?.x ?? 0),
            y: Number(point?.y ?? 0),
          }))
          .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y)),
      }))
      .filter((item) => item.points.length > 1);
  } catch {
    return [];
  }
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
  const [annotationStrokes, setAnnotationStrokes] = useState<AnnotationStroke[]>([]);
  const [annotationDraft, setAnnotationDraft] = useState<AnnotationPoint[] | null>(null);
  const [annotationLoaded, setAnnotationLoaded] = useState(false);

  const drawingRef = useRef(false);
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
      setAnnotationStrokes([]);
      setAnnotationDraft(null);
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
      setAnnotationDraft(null);
      return;
    }
    setAnnotationLoaded(false);
    setAnnotationStrokes([]);
    setAnnotationDraft(null);

    void readFile(projectId, annotationPath)
      .then((result) => {
        if (!disposed) {
          setAnnotationStrokes(parseAnnotationPayload(result.content));
        }
      })
      .catch(() => {
        if (!disposed) {
          setAnnotationStrokes([]);
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
        version: 1,
        strokes: annotationStrokes,
      };
      void writeFile(projectId, annotationPath, JSON.stringify(payload, null, 2));
    }, 180);
    return () => {
      window.clearTimeout(timer);
    };
  }, [annotationLoaded, annotationPath, annotationStrokes, projectId]);

  useEffect(() => {
    if (viewMode !== "pdf" || !hasPdf) {
      setAnnotationEnabled(false);
      drawingRef.current = false;
      setAnnotationDraft(null);
    }
  }, [hasPdf, viewMode]);

  const finishDrawing = useCallback(() => {
    if (!drawingRef.current) {
      return;
    }
    drawingRef.current = false;
    setAnnotationDraft((previous) => {
      if (!previous || previous.length < 2) {
        return null;
      }
      const stroke: AnnotationStroke = {
        id: `stroke-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        points: previous,
      };
      setAnnotationStrokes((items) => [...items, stroke]);
      return null;
    });
  }, []);

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
                onClick={() => setAnnotationEnabled((prev) => !prev)}
                disabled={!hasPdf}
              >
                <Highlighter className="h-3.5 w-3.5" />
              </button>
              <button
                className="rounded border border-slate-300 bg-white p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                title={t("preview.annotationUndo")}
                aria-label={t("preview.annotationUndo")}
                onClick={() => setAnnotationStrokes((items) => items.slice(0, -1))}
                disabled={!hasPdf || annotationStrokes.length === 0}
              >
                <Undo2 className="h-3.5 w-3.5" />
              </button>
              <button
                className="rounded border border-slate-300 bg-white p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                title={t("preview.annotationClear")}
                aria-label={t("preview.annotationClear")}
                onClick={() => {
                  setAnnotationStrokes([]);
                  setAnnotationDraft(null);
                }}
                disabled={!hasPdf || annotationStrokes.length === 0}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
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
                  annotationEnabled ? "cursor-crosshair" : "cursor-default"
                }`}
              >
                <iframe
                  title={filenameFromPath(selectedPath)}
                  src={pdfUrl}
                  className="h-full w-full"
                  style={{ pointerEvents: annotationEnabled ? "none" : "auto" }}
                />
                <svg
                  className={`absolute inset-0 z-10 h-full w-full ${annotationEnabled ? "pointer-events-auto" : "pointer-events-none"}`}
                  viewBox="0 0 1000 1000"
                  preserveAspectRatio="none"
                  onMouseDown={(event) => {
                    if (!annotationEnabled) {
                      return;
                    }
                    const rect = viewportRef.current?.getBoundingClientRect();
                    if (!rect) {
                      return;
                    }
                    drawingRef.current = true;
                    const first = clampPointToView(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height);
                    setAnnotationDraft([first]);
                  }}
                  onMouseMove={(event) => {
                    if (!annotationEnabled || !drawingRef.current) {
                      return;
                    }
                    const rect = viewportRef.current?.getBoundingClientRect();
                    if (!rect) {
                      return;
                    }
                    const point = clampPointToView(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height);
                    setAnnotationDraft((previous) => (previous ? [...previous, point] : [point]));
                  }}
                  onMouseUp={() => finishDrawing()}
                  onMouseLeave={() => finishDrawing()}
                >
                  {annotationStrokes.map((stroke) => (
                    <polyline
                      key={stroke.id}
                      points={stroke.points.map((point) => `${point.x},${point.y}`).join(" ")}
                      fill="none"
                      stroke="rgba(250, 204, 21, 0.58)"
                      strokeWidth="16"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ))}
                  {annotationDraft && annotationDraft.length > 1 ? (
                    <polyline
                      points={annotationDraft.map((point) => `${point.x},${point.y}`).join(" ")}
                      fill="none"
                      stroke="rgba(250, 204, 21, 0.62)"
                      strokeWidth="16"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ) : null}
                </svg>
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
