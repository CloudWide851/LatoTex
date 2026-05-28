import { FileText, Image, Minus, Plus, RefreshCw, Save, ZoomIn } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../../components/ui/button";
import { cn } from "../../../lib/utils";
import { readDocx, writeDocx } from "../../../shared/api/docx";
import type { ResourceNode } from "../../../shared/types/app";
import { buildWorkspacePreviewUrl } from "../../../shared/utils/workspaceResource";
import { DocxRibbonPopup, type RibbonTab } from "./DocxRibbonPopup";
import {
  countMatches,
  countWords,
  currentResourceQuery,
  execFormat,
  flattenResources,
  mapDocxStatus,
  replaceResourceTriggerWithHtml,
  sanitizeDocxHtml,
  stripHtml,
  type ResourceSuggestion,
  type TranslationFn,
} from "./docxUtils";

type MarkState = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikeThrough: boolean;
  subscript: boolean;
  superscript: boolean;
};

const DEFAULT_MARKS: MarkState = {
  bold: false,
  italic: false,
  underline: false,
  strikeThrough: false,
  subscript: false,
  superscript: false,
};

const RIBBON_TABS: RibbonTab[] = ["file", "text", "paragraph", "insert", "find"];

function storageKey(projectId: string, selectedPath: string | null) {
  return `latotex.docx.zoom.${projectId}.${selectedPath ?? "-"}`;
}

function clampZoom(value: number) {
  return Math.max(0.5, Math.min(2.2, Number(value.toFixed(2))));
}

export function DocxWorkspace(props: {
  projectId: string;
  selectedPath: string | null;
  busy: boolean;
  tree?: ResourceNode[];
  autoSaveEnabled?: boolean;
  onRescan: () => void | Promise<void>;
  t: TranslationFn;
}) {
  const { projectId, selectedPath, busy, tree = [], autoSaveEnabled = false, onRescan, t } = props;
  const editorRef = useRef<HTMLDivElement | null>(null);
  const syncTimerRef = useRef<number | null>(null);
  const autoSaveTimerRef = useRef<number | null>(null);
  const chromeRef = useRef<HTMLDivElement | null>(null);
  const [html, setHtml] = useState("<p><br></p>");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [fontFamily, setFontFamily] = useState("Microsoft YaHei");
  const [fontSize, setFontSize] = useState("3");
  const [fontColor, setFontColor] = useState("#0f172a");
  const [highlightColor, setHighlightColor] = useState("#fef3c7");
  const [activeMarks, setActiveMarks] = useState<MarkState>(DEFAULT_MARKS);
  const [activeRibbonTab, setActiveRibbonTab] = useState<RibbonTab | null>(null);
  const [resourceQuery, setResourceQuery] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const resources = useMemo(() => flattenResources(tree), [tree]);

  useEffect(() => {
    if (!selectedPath) {
      setZoom(1);
      return;
    }
    const stored = Number(window.localStorage.getItem(storageKey(projectId, selectedPath)) ?? 1);
    setZoom(clampZoom(Number.isFinite(stored) ? stored : 1));
  }, [projectId, selectedPath]);

  useEffect(() => {
    if (selectedPath) {
      window.localStorage.setItem(storageKey(projectId, selectedPath), String(zoom));
    }
  }, [projectId, selectedPath, zoom]);

  useEffect(() => {
    if (!selectedPath) {
      setHtml("<p><br></p>");
      setWarnings([]);
      setDirty(false);
      setStatus(null);
      return;
    }
    let disposed = false;
    const loadPath = selectedPath;
    setLoading(true);
    setStatus(null);
    setWarnings([]);
    readDocx(projectId, loadPath)
      .then((result) => {
        if (disposed || result.relativePath !== loadPath) {
          return;
        }
        setHtml(result.html || "<p><br></p>");
        setWarnings(result.warnings);
        setDirty(false);
        setStatus(null);
      })
      .catch((error) => {
        if (!disposed) {
          setStatus(mapDocxStatus(String(error), t));
          setWarnings([]);
        }
      })
      .finally(() => {
        if (!disposed) {
          setLoading(false);
        }
      });
    return () => {
      disposed = true;
    };
  }, [projectId, reloadToken, selectedPath, t]);

  useEffect(() => () => {
    if (syncTimerRef.current !== null) {
      window.clearTimeout(syncTimerRef.current);
    }
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
    }
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!chromeRef.current?.contains(event.target as Node)) {
        setActiveRibbonTab(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveRibbonTab(null);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const syncHtmlFromDom = useCallback(() => {
    setHtml(sanitizeDocxHtml(editorRef.current?.innerHTML || "<p><br></p>"));
    setDirty(true);
  }, []);

  const syncHtmlFromDomDebounced = useCallback(() => {
    setDirty(true);
    if (syncTimerRef.current !== null) {
      window.clearTimeout(syncTimerRef.current);
    }
    syncTimerRef.current = window.setTimeout(() => {
      setHtml(sanitizeDocxHtml(editorRef.current?.innerHTML || "<p><br></p>"));
      syncTimerRef.current = null;
    }, 180);
  }, []);

  const refreshActiveMarks = useCallback(() => {
    setActiveMarks({
      bold: document.queryCommandState("bold"),
      italic: document.queryCommandState("italic"),
      underline: document.queryCommandState("underline"),
      strikeThrough: document.queryCommandState("strikeThrough"),
      subscript: document.queryCommandState("subscript"),
      superscript: document.queryCommandState("superscript"),
    });
  }, []);

  const applyFormat = useCallback((command: string, value?: string) => {
    editorRef.current?.focus();
    execFormat(command, value);
    syncHtmlFromDom();
    refreshActiveMarks();
  }, [refreshActiveMarks, syncHtmlFromDom]);

  const save = useCallback(async (options: { rescan?: boolean; auto?: boolean } = {}) => {
    if (!selectedPath || saving) {
      return;
    }
    const nextHtml = sanitizeDocxHtml(editorRef.current?.innerHTML || html);
    setSaving(true);
    setStatus(null);
    try {
      await writeDocx(projectId, selectedPath, nextHtml);
      setHtml(nextHtml);
      setDirty(false);
      setStatus(t(options.auto ? "docx.autoSaved" : "docx.saved"));
      if (options.rescan ?? true) {
        await onRescan();
      }
    } catch (error) {
      setStatus(mapDocxStatus(String(error), t));
    } finally {
      setSaving(false);
    }
  }, [html, onRescan, projectId, saving, selectedPath, t]);

  useEffect(() => {
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    if (!autoSaveEnabled || !dirty || loading || saving || !selectedPath) {
      return;
    }
    autoSaveTimerRef.current = window.setTimeout(() => {
      void save({ auto: true, rescan: false });
      autoSaveTimerRef.current = null;
    }, 1200);
  }, [autoSaveEnabled, dirty, loading, save, saving, selectedPath, html]);

  const insertLink = () => {
    const url = window.prompt(t("docx.linkPrompt"));
    if (url) {
      applyFormat("createLink", url);
    }
  };

  const insertTable = () => {
    editorRef.current?.focus();
    execFormat("insertHTML", `<table><tbody><tr><td>${t("docx.tableCell")}</td><td>${t("docx.tableCell")}</td></tr><tr><td>${t("docx.tableCell")}</td><td>${t("docx.tableCell")}</td></tr></tbody></table><p><br></p>`);
    syncHtmlFromDom();
  };

  const insertPageBreak = () => {
    editorRef.current?.focus();
    execFormat("insertHTML", `<p data-docx-page-break="true"><br></p>`);
    syncHtmlFromDom();
  };

  const insertResource = (resource: ResourceSuggestion) => {
    editorRef.current?.focus();
    const safeName = resource.name.replace(/[<>&"]/g, "");
    const safePath = resource.path.replace(/"/g, "&quot;");
    const htmlSnippet = resource.image
      ? `<img data-docx-resource="${safePath}" src="${buildWorkspacePreviewUrl(projectId, resource.path)}" alt="${safeName}" /><p><br></p>`
      : `<a href="#${safePath}" data-docx-resource="${safePath}">${safeName}</a>`;
    if (!replaceResourceTriggerWithHtml(htmlSnippet)) {
      execFormat("insertHTML", htmlSnippet);
    }
    setResourceQuery(null);
    syncHtmlFromDom();
  };

  const updateResourceQuery = () => setResourceQuery(currentResourceQuery());

  const replaceAll = () => {
    if (!findText) {
      return;
    }
    const current = editorRef.current?.innerHTML || html;
    const escaped = findText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const nextHtml = sanitizeDocxHtml(current.replace(new RegExp(escaped, "gi"), replaceText));
    if (editorRef.current) {
      editorRef.current.innerHTML = nextHtml;
    }
    setHtml(nextHtml);
    setDirty(true);
    setStatus(t("docx.replaceDone"));
  };

  const findNext = () => {
    if (!findText || !editorRef.current) {
      return;
    }
    editorRef.current.focus();
    const findInPage = (window as Window & { find?: (...args: unknown[]) => boolean }).find;
    const found = typeof findInPage === "function"
      ? findInPage(findText, false, false, true, false, false, false)
      : false;
    setStatus(found ? t("docx.findFound") : t("docx.findNone"));
  };

  const handleWorkspaceKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.altKey) {
      const index = Number(event.key) - 1;
      if (index >= 0 && index < RIBBON_TABS.length) {
        event.preventDefault();
        setActiveRibbonTab(RIBBON_TABS[index]);
        return;
      }
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      setActiveRibbonTab("find");
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void save();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") {
      event.preventDefault();
      applyFormat("bold");
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "i") {
      event.preventDefault();
      applyFormat("italic");
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "u") {
      event.preventDefault();
      applyFormat("underline");
    }
  };

  const findCount = useMemo(() => countMatches(stripHtml(html), findText), [findText, html]);
  const wordCount = useMemo(() => countWords(html), [html]);
  const ribbonDisabled = !selectedPath || loading || saving || busy;
  const matchingResources = useMemo(() => {
    if (resourceQuery === null) {
      return [];
    }
    return resources
      .filter((item) => !resourceQuery || item.name.toLowerCase().includes(resourceQuery))
      .slice(0, 8);
  }, [resourceQuery, resources]);

  const zoomOut = () => setZoom((prev) => clampZoom(prev - 0.1));
  const zoomIn = () => setZoom((prev) => clampZoom(prev + 0.1));
  const resetZoom = () => setZoom(1);

  return (
    <section
      className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-lg border border-[color:var(--editor-widget-border)] bg-[color:var(--editor-paper-bg)] shadow-soft"
      onKeyDown={handleWorkspaceKeyDown}
    >
      <header ref={chromeRef} className="relative z-30 border-b border-[color:var(--editor-widget-border)] bg-[color:var(--editor-widget-bg)]">
        <div className="flex min-h-10 items-center justify-between gap-3 px-3 py-2">
          <div className="min-w-0">
            <h2 className="flex items-center gap-1.5 truncate text-sm font-semibold text-slate-800">
              <FileText className="h-4 w-4" />
              {selectedPath ?? t("docx.select")}
              {dirty ? " *" : ""}
            </h2>
            {warnings.length > 0 ? (
              <p className="truncate text-[11px] text-amber-700">{warnings.map((key) => t(key)).join(" ")}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button size="icon" variant="ghost" className="h-8 w-8" disabled={!selectedPath} onClick={zoomOut} title={t("docx.zoomOut")} aria-label={t("docx.zoomOut")}>
              <Minus className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="ghost" className="h-8 min-w-16 px-2 text-xs" disabled={!selectedPath} onClick={resetZoom}>
              {Math.round(zoom * 100)}%
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" disabled={!selectedPath} onClick={zoomIn} title={t("docx.zoomIn")} aria-label={t("docx.zoomIn")}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="secondary" disabled={ribbonDisabled} onClick={() => setReloadToken((prev) => prev + 1)}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              {t("docx.reload")}
            </Button>
            <Button size="sm" disabled={ribbonDisabled} onClick={() => void save()}>
              <Save className="mr-1.5 h-3.5 w-3.5" />
              {saving ? t("common.loading") : t("docx.save")}
            </Button>
          </div>
        </div>
        <div className="border-t border-[color:var(--editor-widget-border)] px-3 py-2">
          <div className="flex flex-wrap gap-1">
            {RIBBON_TABS.map((tab, index) => (
              <Button
                key={tab}
                size="sm"
                variant={activeRibbonTab === tab ? "secondary" : "ghost"}
                className="h-8"
                title={`Alt+${index + 1}`}
                onClick={() => setActiveRibbonTab((prev) => (prev === tab ? null : tab))}
              >
                {t(`docx.ribbon.${tab}`)}
              </Button>
            ))}
          </div>
          {activeRibbonTab ? (
            <div className="absolute left-3 top-[calc(100%-2px)] z-40">
              <DocxRibbonPopup
                activeTab={activeRibbonTab}
                disabled={ribbonDisabled}
                activeMarks={activeMarks}
                fontFamily={fontFamily}
                fontSize={fontSize}
                fontColor={fontColor}
                highlightColor={highlightColor}
                findText={findText}
                replaceText={replaceText}
                imageDisabled={resources.filter((item) => item.image).length === 0}
                onFontFamilyChange={(value) => {
                  setFontFamily(value);
                  applyFormat("fontName", value);
                }}
                onFontSizeChange={(value) => {
                  setFontSize(value);
                  applyFormat("fontSize", value);
                }}
                onFontColorChange={(value) => {
                  setFontColor(value);
                  applyFormat("foreColor", value);
                }}
                onHighlightColorChange={(value) => {
                  setHighlightColor(value);
                  applyFormat("hiliteColor", value);
                }}
                onFindTextChange={setFindText}
                onReplaceTextChange={setReplaceText}
                onFormat={applyFormat}
                onInsertLink={insertLink}
                onInsertTable={insertTable}
                onInsertPageBreak={insertPageBreak}
                onInsertImage={() => setResourceQuery("")}
                onFindNext={findNext}
                onReplaceAll={replaceAll}
                t={t}
              />
            </div>
          ) : null}
        </div>
      </header>
      <div
        className="docx-page-wrap min-h-0 overflow-auto bg-[color:var(--editor-paper-bg)] px-3 py-4"
        style={{ ["--docx-zoom" as string]: String(zoom) }}
        onWheel={(event) => {
          if (event.ctrlKey && selectedPath) {
            event.preventDefault();
            setZoom((prev) => clampZoom(prev + (event.deltaY < 0 ? 0.1 : -0.1)));
          }
        }}
      >
        {!selectedPath ? (
          <div className="flex h-full items-center justify-center rounded-md border border-dashed border-slate-300 bg-white/70 text-xs text-slate-500">
            {t("docx.select")}
          </div>
        ) : loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-xs text-slate-500">
            <ZoomIn className="h-4 w-4 animate-pulse" />
            {t("docx.loading")}
          </div>
        ) : (
          <div className="docx-page-frame relative mx-auto">
            <div className="mb-1 h-5 rounded-t border-x border-t border-slate-200 bg-[repeating-linear-gradient(90deg,#e2e8f0_0,#e2e8f0_1px,transparent_1px,transparent_48px)]" />
            <div
              key={selectedPath}
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              className={cn(
                "docx-page-surface mx-auto w-full bg-white text-slate-900 shadow-[0_22px_56px_rgba(15,23,42,0.16)] outline-none",
                "prose prose-slate prose-sm max-w-none focus:ring-2 focus:ring-[color:var(--app-accent)]",
              )}
              dangerouslySetInnerHTML={{ __html: html }}
              onInput={syncHtmlFromDomDebounced}
              onMouseUp={refreshActiveMarks}
              onKeyUp={refreshActiveMarks}
              onKeyUpCapture={updateResourceQuery}
              onPaste={(event) => {
                event.preventDefault();
                const text = event.clipboardData.getData("text/plain");
                execFormat("insertText", text);
                syncHtmlFromDom();
              }}
            />
            {resourceQuery !== null ? (
              <div className="absolute left-6 top-16 z-20 w-72 overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg">
                {matchingResources.length > 0 ? matchingResources.map((resource) => (
                  <button
                    key={resource.path}
                    type="button"
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => insertResource(resource)}
                  >
                    {resource.image ? <Image className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                    <span className="min-w-0 flex-1 truncate">{resource.name}</span>
                    <span className="max-w-32 truncate text-[10px] text-slate-400">{resource.path}</span>
                  </button>
                )) : (
                  <div className="px-2 py-2 text-xs text-slate-500">{t("docx.resource.none")}</div>
                )}
              </div>
            ) : null}
          </div>
        )}
      </div>
      <footer className="flex min-h-8 items-center justify-between gap-3 border-t border-[color:var(--editor-widget-border)] bg-[color:var(--editor-widget-bg)] px-3 py-1.5 text-[11px] text-slate-500">
        <span className="truncate">{status || t("docx.wordCount").replace("{count}", String(wordCount))}</span>
        <span className="shrink-0">{findText ? t("docx.findCount").replace("{count}", String(findCount)) : selectedPath || ""}</span>
      </footer>
    </section>
  );
}
