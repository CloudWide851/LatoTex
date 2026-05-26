import {
  Bold,
  FileText,
  Heading1,
  Heading2,
  Italic,
  List,
  ListOrdered,
  RefreshCw,
  Save,
  Underline,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../../components/ui/button";
import { cn } from "../../../lib/utils";
import { readDocx, writeDocx } from "../../../shared/api/docx";
import type { ResourceNode } from "../../../shared/types/app";
import { ExplorerTree } from "../ExplorerTree";

type TranslationFn = (key: any) => string;

function filterDocxNodes(nodes: ResourceNode[]): ResourceNode[] {
  const walk = (node: ResourceNode): ResourceNode | null => {
    if (node.kind === "file") {
      return /\.docx$/i.test(node.relativePath) ? node : null;
    }
    const children = node.children
      .map((child) => walk(child))
      .filter((child): child is ResourceNode => Boolean(child));
    return children.length > 0 ? { ...node, children } : null;
  };
  return nodes.map((node) => walk(node)).filter((node): node is ResourceNode => Boolean(node));
}

function collectDocxPaths(nodes: ResourceNode[]): string[] {
  const out: string[] = [];
  const walk = (items: ResourceNode[]) => {
    for (const item of items) {
      if (item.kind === "file" && /\.docx$/i.test(item.relativePath)) {
        out.push(item.relativePath);
      } else if (item.kind === "directory") {
        walk(item.children);
      }
    }
  };
  walk(nodes);
  return out;
}

function execFormat(command: string, value?: string) {
  document.execCommand(command, false, value);
}

export function DocxWorkspace(props: {
  projectId: string;
  tree: ResourceNode[];
  busy: boolean;
  onRescan: () => void | Promise<void>;
  t: TranslationFn;
}) {
  const { projectId, tree, busy, onRescan, t } = props;
  const editorRef = useRef<HTMLDivElement | null>(null);
  const filteredTree = useMemo(() => filterDocxNodes(tree), [tree]);
  const docxPaths = useMemo(() => collectDocxPaths(filteredTree), [filteredTree]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [html, setHtml] = useState("<p><br></p>");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (selectedPath && docxPaths.includes(selectedPath)) {
      return;
    }
    setSelectedPath(docxPaths[0] ?? null);
  }, [docxPaths, selectedPath]);

  useEffect(() => {
    if (!selectedPath) {
      setHtml("<p><br></p>");
      setWarnings([]);
      setDirty(false);
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
    setHtml(editorRef.current?.innerHTML || "<p><br></p>");
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
    const nextHtml = editorRef.current?.innerHTML || html;
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

  const toolbar = [
    { key: "bold", icon: Bold, command: "bold", label: t("docx.format.bold") },
    { key: "italic", icon: Italic, command: "italic", label: t("docx.format.italic") },
    { key: "underline", icon: Underline, command: "underline", label: t("docx.format.underline") },
    { key: "h1", icon: Heading1, command: "formatBlock", value: "h1", label: t("docx.format.h1") },
    { key: "h2", icon: Heading2, command: "formatBlock", value: "h2", label: t("docx.format.h2") },
    { key: "bullet", icon: List, command: "insertUnorderedList", label: t("docx.format.bullet") },
    { key: "numbered", icon: ListOrdered, command: "insertOrderedList", label: t("docx.format.numbered") },
  ];

  return (
    <section className="grid h-full min-h-0 grid-cols-[minmax(160px,0.35fr)_minmax(0,1fr)] gap-px rounded-lg border border-slate-200 bg-slate-200 shadow-soft">
      <aside className="min-h-0 bg-white p-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <FileText className="h-3.5 w-3.5" />
            {t("docx.title")}
          </h2>
          <Button size="icon" variant="ghost" className="h-7 w-7" disabled={busy} onClick={() => void onRescan()}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
        <ExplorerTree
          tree={filteredTree}
          selectedPath={selectedPath}
          busy={busy}
          onSelect={setSelectedPath}
          defaultExpanded
          t={t}
        />
      </aside>
      <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] bg-[color:var(--editor-paper-bg)]">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--editor-widget-border)] bg-[color:var(--editor-widget-bg)] px-3 py-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-800">
              {selectedPath ?? t("docx.select")}
              {dirty ? " *" : ""}
            </div>
            {warnings.length > 0 ? (
              <div className="truncate text-[11px] text-amber-700">
                {warnings.map((key) => t(key)).join(" ")}
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {toolbar.map((item) => {
              const Icon = item.icon;
              return (
                <Button
                  key={item.key}
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  title={item.label}
                  aria-label={item.label}
                  disabled={!selectedPath || loading}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => applyFormat(item.command, item.value)}
                >
                  <Icon className="h-4 w-4" />
                </Button>
              );
            })}
            <Button size="sm" variant="secondary" disabled={!selectedPath || loading} onClick={() => setReloadToken((prev) => prev + 1)}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              {t("docx.reload")}
            </Button>
            <Button size="sm" disabled={!selectedPath || loading || saving} onClick={() => void save()}>
              <Save className="mr-1.5 h-3.5 w-3.5" />
              {saving ? t("common.loading") : t("docx.save")}
            </Button>
          </div>
        </header>
        <div className="min-h-0 overflow-auto p-4">
          {!selectedPath ? (
            <div className="flex h-full items-center justify-center rounded-md border border-dashed border-slate-300 bg-white text-xs text-slate-500">
              {docxPaths.length === 0 ? t("docx.empty") : t("docx.select")}
            </div>
          ) : loading ? (
            <div className="flex h-full items-center justify-center text-xs text-slate-500">{t("docx.loading")}</div>
          ) : (
            <div
              key={selectedPath}
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              className={cn(
                "mx-auto min-h-full w-full max-w-3xl rounded-md border border-slate-200 bg-white px-8 py-7 text-sm leading-7 text-slate-900 shadow-sm outline-none",
                "prose prose-slate prose-sm max-w-3xl focus:border-[color:var(--app-accent)]",
              )}
              dangerouslySetInnerHTML={{ __html: html }}
              onInput={syncHtmlFromDom}
              onPaste={(event) => {
                event.preventDefault();
                const text = event.clipboardData.getData("text/plain");
                execFormat("insertText", text);
                syncHtmlFromDom();
              }}
            />
          )}
        </div>
        <footer className="min-h-8 border-t border-[color:var(--editor-widget-border)] bg-[color:var(--editor-widget-bg)] px-3 py-1.5 text-[11px] text-slate-500">
          {status}
        </footer>
      </div>
    </section>
  );
}
