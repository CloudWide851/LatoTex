import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Highlighter,
  FileText,
  Heading1,
  Heading2,
  Image,
  Italic,
  Link,
  List,
  ListOrdered,
  Paintbrush,
  Redo2,
  RefreshCw,
  Replace,
  Save,
  Search,
  Table2,
  Underline,
  Undo2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { cn } from "../../../lib/utils";
import { readDocx, writeDocx } from "../../../shared/api/docx";
import type { ResourceNode } from "../../../shared/types/app";
import { buildWorkspacePreviewUrl } from "../../../shared/utils/workspaceResource";

type TranslationFn = (key: any) => string;
type RibbonTab = "file" | "text" | "paragraph" | "insert" | "find";
type ResourceSuggestion = { name: string; path: string; image: boolean };

function execFormat(command: string, value?: string) {
  document.execCommand(command, false, value);
}

function mapDocxStatus(raw: string, t: TranslationFn): string {
  if (raw.includes("invalid Zip archive") || raw.includes("docx.document_missing")) {
    return t("docx.error.invalidArchive");
  }
  return raw;
}

function sanitizeDocxHtml(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  const allowedTags = new Set(["P", "BR", "STRONG", "B", "EM", "I", "U", "H1", "H2", "H3", "UL", "OL", "LI", "A", "TABLE", "TBODY", "TR", "TD", "TH", "SPAN", "IMG"]);
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const element = child as HTMLElement;
        if (!allowedTags.has(element.tagName)) {
          element.replaceWith(...Array.from(element.childNodes));
          continue;
        }
        for (const attr of Array.from(element.attributes)) {
          const name = attr.name.toLowerCase();
          const value = attr.value.trim();
          const safeHref = name === "href" && /^(https?:|mailto:|#)/i.test(value);
          const safeImageMarker = name === "data-docx-image";
          const safeImageResource = element.tagName === "IMG" && name === "data-docx-resource" && !value.includes("..");
          const safeImageSrc = element.tagName === "IMG" && name === "src" && /^(latotex-resource:|https?:\/\/latotex-resource\.localhost|blob:)/i.test(value);
          const safeAlt = element.tagName === "IMG" && name === "alt";
          const safeEditable = name === "contenteditable" && element.hasAttribute("data-docx-image");
          if (!safeHref && !safeImageMarker && !safeImageResource && !safeImageSrc && !safeAlt && !safeEditable) {
            element.removeAttribute(attr.name);
          }
        }
      }
      walk(child);
    }
  };
  walk(template.content);
  return template.innerHTML || "<p><br></p>";
}

function stripHtml(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content.textContent ?? "";
}

function countWords(html: string): number {
  return stripHtml(html).split(/\s+/).filter(Boolean).length;
}

function countMatches(text: string, needle: string): number {
  if (!needle.trim()) {
    return 0;
  }
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return Array.from(text.matchAll(new RegExp(escaped, "gi"))).length;
}

function flattenResources(nodes: ResourceNode[]): ResourceSuggestion[] {
  const imageExts = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
  const out: ResourceSuggestion[] = [];
  const visit = (items: ResourceNode[]) => {
    items.forEach((node) => {
      if (node.kind === "file") {
        const ext = node.name.split(".").pop()?.toLowerCase() ?? "";
        out.push({ name: node.name, path: node.relativePath, image: imageExts.has(ext) });
      } else {
        visit(node.children ?? []);
      }
    });
  };
  visit(nodes);
  return out;
}

export function DocxWorkspace(props: {
  projectId: string;
  selectedPath: string | null;
  busy: boolean;
  tree?: ResourceNode[];
  onRescan: () => void | Promise<void>;
  t: TranslationFn;
}) {
  const { projectId, selectedPath, busy, tree = [], onRescan, t } = props;
  const editorRef = useRef<HTMLDivElement | null>(null);
  const syncTimerRef = useRef<number | null>(null);
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
  const [activeMarks, setActiveMarks] = useState({ bold: false, italic: false, underline: false });
  const [activeRibbonTab, setActiveRibbonTab] = useState<RibbonTab>("text");
  const [resourceQuery, setResourceQuery] = useState<string | null>(null);
  const resources = useMemo(() => flattenResources(tree), [tree]);

  useEffect(() => {
    if (!selectedPath) {
      setHtml("<p><br></p>");
      setWarnings([]);
      setDirty(false);
      setStatus(null);
      return;
    }
    let disposed = false;
    setLoading(true);
    setStatus(null);
    readDocx(projectId, selectedPath)
      .then((result) => {
        if (disposed) {
          return;
        }
        setHtml(result.html || "<p><br></p>");
        setWarnings(result.warnings);
        setDirty(false);
      })
      .catch((error) => {
        if (!disposed) {
          setStatus(mapDocxStatus(String(error), t));
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
  }, []);

  const syncHtmlFromDom = () => {
    setHtml(sanitizeDocxHtml(editorRef.current?.innerHTML || "<p><br></p>"));
    setDirty(true);
  };

  const syncHtmlFromDomDebounced = () => {
    setDirty(true);
    if (syncTimerRef.current !== null) {
      window.clearTimeout(syncTimerRef.current);
    }
    syncTimerRef.current = window.setTimeout(() => {
      setHtml(sanitizeDocxHtml(editorRef.current?.innerHTML || "<p><br></p>"));
      syncTimerRef.current = null;
    }, 180);
  };

  const refreshActiveMarks = () => {
    setActiveMarks({
      bold: document.queryCommandState("bold"),
      italic: document.queryCommandState("italic"),
      underline: document.queryCommandState("underline"),
    });
  };

  const applyFormat = (command: string, value?: string) => {
    editorRef.current?.focus();
    execFormat(command, value);
    syncHtmlFromDom();
    refreshActiveMarks();
  };

  const save = async () => {
    if (!selectedPath) {
      return;
    }
    const nextHtml = sanitizeDocxHtml(editorRef.current?.innerHTML || html);
    setSaving(true);
    setStatus(null);
    try {
      await writeDocx(projectId, selectedPath, nextHtml);
      setHtml(nextHtml);
      setDirty(false);
      setStatus(t("docx.saved"));
      await onRescan();
    } catch (error) {
      setStatus(mapDocxStatus(String(error), t));
    } finally {
      setSaving(false);
    }
  };

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
    if (resource.image) {
      const src = buildWorkspacePreviewUrl(projectId, resource.path);
      execFormat("insertHTML", `<img data-docx-resource="${safePath}" src="${src}" alt="${safeName}" /><p><br></p>`);
    } else {
      execFormat("insertHTML", `<a href="#${safePath}" data-docx-resource="${safePath}">${safeName}</a>`);
    }
    setResourceQuery(null);
    syncHtmlFromDom();
  };

  const updateResourceQuery = () => {
    const selection = window.getSelection();
    const text = selection?.anchorNode?.textContent ?? "";
    const match = text.match(/@@\s+([^@\n\r]{0,80})$/);
    setResourceQuery(match ? match[1].trim().toLowerCase() : null);
  };

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

  const findCount = useMemo(() => countMatches(stripHtml(html), findText), [findText, html]);
  const wordCount = useMemo(() => countWords(html), [html]);
  const ribbonDisabled = !selectedPath || loading || saving;
  const matchingResources = useMemo(() => {
    if (resourceQuery === null) {
      return [];
    }
    return resources
      .filter((item) => !resourceQuery || item.name.toLowerCase().includes(resourceQuery))
      .slice(0, 8);
  }, [resourceQuery, resources]);

  const formatButtons = [
    { key: "bold", icon: Bold, command: "bold", label: t("docx.format.bold") },
    { key: "italic", icon: Italic, command: "italic", label: t("docx.format.italic") },
    { key: "underline", icon: Underline, command: "underline", label: t("docx.format.underline") },
  ];
  const paragraphButtons = [
    { key: "left", icon: AlignLeft, command: "justifyLeft", label: t("docx.format.alignLeft") },
    { key: "center", icon: AlignCenter, command: "justifyCenter", label: t("docx.format.alignCenter") },
    { key: "right", icon: AlignRight, command: "justifyRight", label: t("docx.format.alignRight") },
    { key: "bullet", icon: List, command: "insertUnorderedList", label: t("docx.format.bullet") },
    { key: "numbered", icon: ListOrdered, command: "insertOrderedList", label: t("docx.format.numbered") },
    { key: "outdent", icon: Undo2, command: "outdent", label: t("docx.format.outdent") },
    { key: "indent", icon: Redo2, command: "indent", label: t("docx.format.indent") },
  ];
  const ribbonTabs: Array<{ key: RibbonTab; label: string }> = [
    { key: "file", label: t("docx.ribbon.file") },
    { key: "text", label: t("docx.ribbon.text") },
    { key: "paragraph", label: t("docx.ribbon.paragraph") },
    { key: "insert", label: t("docx.ribbon.insert") },
    { key: "find", label: t("docx.ribbon.find") },
  ];

  return (
    <section className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-lg border border-[color:var(--editor-widget-border)] bg-[color:var(--editor-paper-bg)] shadow-soft">
      <header className="border-b border-[color:var(--editor-widget-border)] bg-[color:var(--editor-widget-bg)]">
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
          <div className="mb-2 flex flex-wrap gap-1">
            {ribbonTabs.map((tab) => (
              <Button
                key={tab.key}
                size="sm"
                variant={activeRibbonTab === tab.key ? "secondary" : "ghost"}
                className="h-8"
                onClick={() => setActiveRibbonTab(tab.key)}
              >
                {tab.label}
              </Button>
            ))}
          </div>
          <div className="settings-scrollbar-hidden flex min-h-10 gap-2 overflow-x-auto">
          {activeRibbonTab === "file" ? (
            <div className="docx-ribbon-group">
              <Button size="icon" variant="ghost" className="h-8 w-8" title={t("docx.format.undo")} aria-label={t("docx.format.undo")} disabled={ribbonDisabled} onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormat("undo")}>
                <Undo2 className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" className="h-8 w-8" title={t("docx.format.redo")} aria-label={t("docx.format.redo")} disabled={ribbonDisabled} onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormat("redo")}>
                <Redo2 className="h-4 w-4" />
              </Button>
            </div>
          ) : null}
          {activeRibbonTab === "text" ? (
          <>
          <div className="docx-ribbon-group">
            <span>{t("docx.ribbon.style")}</span>
            <select className="h-8 rounded border border-slate-200 bg-white px-2 text-xs" disabled={ribbonDisabled} defaultValue="p" onChange={(event) => applyFormat("formatBlock", event.target.value)}>
              <option value="p">{t("docx.format.paragraph")}</option>
              <option value="h1">{t("docx.format.h1")}</option>
              <option value="h2">{t("docx.format.h2")}</option>
              <option value="h3">{t("docx.format.h3")}</option>
            </select>
          </div>
          <div className="docx-ribbon-group">
            <span>{t("docx.ribbon.font")}</span>
            <div className="flex flex-wrap gap-1">
              <select className="h-8 max-w-32 rounded border border-slate-200 bg-white px-2 text-xs" disabled={ribbonDisabled} value={fontFamily} onChange={(event) => {
                setFontFamily(event.target.value);
                applyFormat("fontName", event.target.value);
              }}>
                <option value="Microsoft YaHei">{t("docx.font.sans")}</option>
                <option value="SimSun">{t("docx.font.serif")}</option>
                <option value="Consolas">{t("docx.font.mono")}</option>
              </select>
              <select className="h-8 w-16 rounded border border-slate-200 bg-white px-2 text-xs" disabled={ribbonDisabled} value={fontSize} onChange={(event) => {
                setFontSize(event.target.value);
                applyFormat("fontSize", event.target.value);
              }}>
                <option value="2">10</option>
                <option value="3">12</option>
                <option value="4">14</option>
                <option value="5">18</option>
                <option value="6">24</option>
              </select>
              {formatButtons.map((item) => {
                const Icon = item.icon;
                return (
                  <Button key={item.key} size="icon" variant={activeMarks[item.key as keyof typeof activeMarks] ? "secondary" : "ghost"} className="h-8 w-8" title={item.label} aria-label={item.label} disabled={ribbonDisabled} onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormat(item.command)}>
                    <Icon className="h-4 w-4" />
                  </Button>
                );
              })}
              <label className="relative inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600" title={t("docx.format.color")}>
                <Paintbrush className="h-4 w-4" />
                <input className="absolute inset-0 opacity-0" type="color" value={fontColor} disabled={ribbonDisabled} onChange={(event) => {
                  setFontColor(event.target.value);
                  applyFormat("foreColor", event.target.value);
                }} />
              </label>
              <label className="relative inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600" title={t("docx.format.highlight")}>
                <Highlighter className="h-4 w-4" />
                <input className="absolute inset-0 opacity-0" type="color" value={highlightColor} disabled={ribbonDisabled} onChange={(event) => {
                  setHighlightColor(event.target.value);
                  applyFormat("hiliteColor", event.target.value);
                }} />
              </label>
            </div>
          </div>
          </>
          ) : null}
          {activeRibbonTab === "paragraph" ? (
          <div className="docx-ribbon-group">
            <span>{t("docx.ribbon.paragraph")}</span>
            <div className="flex gap-1">
              {paragraphButtons.map((item) => {
                const Icon = item.icon;
                return (
                  <Button key={item.key} size="icon" variant="ghost" className="h-8 w-8" title={item.label} aria-label={item.label} disabled={ribbonDisabled} onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormat(item.command)}>
                    <Icon className="h-4 w-4" />
                  </Button>
                );
              })}
            </div>
          </div>
          ) : null}
          {activeRibbonTab === "insert" ? (
          <div className="docx-ribbon-group">
            <span>{t("docx.ribbon.insert")}</span>
            <div className="flex gap-1">
              <Button size="icon" variant="ghost" className="h-8 w-8" title={t("docx.format.h1")} aria-label={t("docx.format.h1")} disabled={ribbonDisabled} onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormat("formatBlock", "h1")}>
                <Heading1 className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" className="h-8 w-8" title={t("docx.format.h2")} aria-label={t("docx.format.h2")} disabled={ribbonDisabled} onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormat("formatBlock", "h2")}>
                <Heading2 className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" className="h-8 w-8" title={t("docx.format.link")} aria-label={t("docx.format.link")} disabled={ribbonDisabled} onMouseDown={(event) => event.preventDefault()} onClick={insertLink}>
                <Link className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" className="h-8 w-8" title={t("docx.format.table")} aria-label={t("docx.format.table")} disabled={ribbonDisabled} onMouseDown={(event) => event.preventDefault()} onClick={insertTable}>
                <Table2 className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" className="h-8 w-8" title={t("docx.format.pageBreak")} aria-label={t("docx.format.pageBreak")} disabled={ribbonDisabled} onMouseDown={(event) => event.preventDefault()} onClick={insertPageBreak}>
                <FileText className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" className="h-8 w-8" title={t("docx.format.image")} aria-label={t("docx.format.image")} disabled={ribbonDisabled || resources.filter((item) => item.image).length === 0} onMouseDown={(event) => event.preventDefault()} onClick={() => setResourceQuery("")}>
                <Image className="h-4 w-4" />
              </Button>
            </div>
          </div>
          ) : null}
          {activeRibbonTab === "find" ? (
          <div className="docx-ribbon-group min-w-[330px]">
            <span>{t("docx.ribbon.find")}</span>
            <div className="grid grid-cols-[minmax(90px,1fr)_minmax(90px,1fr)_auto_auto] gap-1">
              <Input className="h-8 text-xs" value={findText} onChange={(event) => setFindText(event.target.value)} placeholder={t("docx.find")} />
              <Input className="h-8 text-xs" value={replaceText} onChange={(event) => setReplaceText(event.target.value)} placeholder={t("docx.replace")} />
              <Button size="icon" variant="secondary" className="h-8 w-8" disabled={!findText || ribbonDisabled} onClick={findNext} title={t("docx.findNext")} aria-label={t("docx.findNext")}>
                <Search className="h-3.5 w-3.5" />
              </Button>
              <Button size="icon" variant="secondary" className="h-8 w-8" disabled={!findText || ribbonDisabled} onClick={replaceAll} title={t("docx.replaceAll")} aria-label={t("docx.replaceAll")}>
                <Replace className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          ) : null}
          </div>
        </div>
      </header>
      <div className="docx-page-wrap min-h-0 overflow-auto bg-[color:var(--editor-paper-bg)] px-3 py-4">
        {!selectedPath ? (
          <div className="flex h-full items-center justify-center rounded-md border border-dashed border-slate-300 bg-white/70 text-xs text-slate-500">
            {t("docx.select")}
          </div>
        ) : loading ? (
          <div className="flex h-full items-center justify-center text-xs text-slate-500">{t("docx.loading")}</div>
        ) : (
          <div className="docx-page-frame mx-auto">
            <div className="mb-1 h-5 rounded-t border-x border-t border-slate-200 bg-[repeating-linear-gradient(90deg,#e2e8f0_0,#e2e8f0_1px,transparent_1px,transparent_48px)]" />
            <div
              key={selectedPath}
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              className={cn(
                "docx-page-surface mx-auto w-full bg-white text-[15px] leading-7 text-slate-900 shadow-[0_22px_56px_rgba(15,23,42,0.16)] outline-none",
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
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
                  event.preventDefault();
                  void save();
                }
                if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") {
                  event.preventDefault();
                  applyFormat("bold");
                }
                if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "i") {
                  event.preventDefault();
                  applyFormat("italic");
                }
                if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "u") {
                  event.preventDefault();
                  applyFormat("underline");
                }
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
