import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  FileText,
  Italic,
  Link,
  List,
  ListOrdered,
  RefreshCw,
  Replace,
  Save,
  Search,
  Table2,
  Underline,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { cn } from "../../../lib/utils";
import { readDocx, writeDocx } from "../../../shared/api/docx";

type TranslationFn = (key: any) => string;

function execFormat(command: string, value?: string) {
  document.execCommand(command, false, value);
}

function sanitizeDocxHtml(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  const allowedTags = new Set(["P", "BR", "STRONG", "B", "EM", "I", "U", "H1", "H2", "H3", "UL", "OL", "LI", "A", "TABLE", "TBODY", "TR", "TD", "TH", "SPAN"]);
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
          const safeEditable = name === "contenteditable" && element.hasAttribute("data-docx-image");
          if (!safeHref && !safeImageMarker && !safeEditable) {
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

export function DocxWorkspace(props: {
  projectId: string;
  selectedPath: string | null;
  busy: boolean;
  onRescan: () => void | Promise<void>;
  t: TranslationFn;
}) {
  const { projectId, selectedPath, busy, onRescan, t } = props;
  const editorRef = useRef<HTMLDivElement | null>(null);
  const [html, setHtml] = useState("<p><br></p>");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");

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
          setStatus(String(error));
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
  }, [projectId, reloadToken, selectedPath]);

  const syncHtmlFromDom = () => {
    setHtml(sanitizeDocxHtml(editorRef.current?.innerHTML || "<p><br></p>"));
    setDirty(true);
  };

  const applyFormat = (command: string, value?: string) => {
    editorRef.current?.focus();
    execFormat(command, value);
    syncHtmlFromDom();
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
      setStatus(String(error));
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
    execFormat("insertHTML", "<table><tbody><tr><td>Cell</td><td>Cell</td></tr><tr><td>Cell</td><td>Cell</td></tr></tbody></table><p><br></p>");
    syncHtmlFromDom();
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
        <div className="settings-scrollbar-hidden flex gap-2 overflow-x-auto border-t border-[color:var(--editor-widget-border)] px-3 py-2">
          <div className="docx-ribbon-group">
            <span>{t("docx.ribbon.style")}</span>
            <select className="h-8 rounded border border-slate-200 bg-white px-2 text-xs" disabled={ribbonDisabled} defaultValue="p" onChange={(event) => applyFormat("formatBlock", event.target.value)}>
              <option value="p">{t("docx.format.paragraph")}</option>
              <option value="h1">{t("docx.format.h1")}</option>
              <option value="h2">{t("docx.format.h2")}</option>
            </select>
          </div>
          <div className="docx-ribbon-group">
            <span>{t("docx.ribbon.font")}</span>
            <div className="flex gap-1">
              {formatButtons.map((item) => {
                const Icon = item.icon;
                return (
                  <Button key={item.key} size="icon" variant="ghost" className="h-8 w-8" title={item.label} aria-label={item.label} disabled={ribbonDisabled} onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormat(item.command)}>
                    <Icon className="h-4 w-4" />
                  </Button>
                );
              })}
            </div>
          </div>
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
          <div className="docx-ribbon-group">
            <span>{t("docx.ribbon.insert")}</span>
            <div className="flex gap-1">
              <Button size="icon" variant="ghost" className="h-8 w-8" title={t("docx.format.link")} aria-label={t("docx.format.link")} disabled={ribbonDisabled} onMouseDown={(event) => event.preventDefault()} onClick={insertLink}>
                <Link className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" className="h-8 w-8" title={t("docx.format.table")} aria-label={t("docx.format.table")} disabled={ribbonDisabled} onMouseDown={(event) => event.preventDefault()} onClick={insertTable}>
                <Table2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
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
        </div>
      </header>
      <div className="min-h-0 overflow-auto bg-[color:var(--editor-paper-bg)] p-5">
        {!selectedPath ? (
          <div className="flex h-full items-center justify-center rounded-md border border-dashed border-slate-300 bg-white/70 text-xs text-slate-500">
            {t("docx.select")}
          </div>
        ) : loading ? (
          <div className="flex h-full items-center justify-center text-xs text-slate-500">{t("docx.loading")}</div>
        ) : (
          <div className="mx-auto max-w-[840px]">
            <div className="mb-1 h-5 rounded-t border-x border-t border-slate-200 bg-[repeating-linear-gradient(90deg,#e2e8f0_0,#e2e8f0_1px,transparent_1px,transparent_48px)]" />
            <div
              key={selectedPath}
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              className={cn(
                "docx-page-surface mx-auto min-h-[960px] w-full bg-white px-16 py-14 text-[15px] leading-7 text-slate-900 shadow-[0_22px_56px_rgba(15,23,42,0.16)] outline-none",
                "prose prose-slate prose-sm max-w-none focus:ring-2 focus:ring-[color:var(--app-accent)]",
              )}
              dangerouslySetInnerHTML={{ __html: html }}
              onInput={syncHtmlFromDom}
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
              }}
            />
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
