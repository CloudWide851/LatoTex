import hljs from "highlight.js";
import { useMemo } from "react";
import { resolveCodeLanguage } from "../../shared/utils/codeLanguage";

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function CodePreviewPane(props: {
  filePath: string | null;
  codeContent: string;
  emptyText: string;
}) {
  const { filePath, codeContent, emptyText } = props;
  const language = useMemo(() => resolveCodeLanguage(filePath), [filePath]);
  const highlighted = useMemo(() => {
    const source = String(codeContent ?? "");
    if (!source.trim()) {
      return "";
    }
    if (language.highlight && hljs.getLanguage(language.highlight)) {
      return hljs.highlight(source, { language: language.highlight, ignoreIllegals: true }).value;
    }
    return escapeHtml(source);
  }, [codeContent, language.highlight]);

  if (!String(codeContent ?? "").trim()) {
    return (
      <div className="flex h-full items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto rounded border border-slate-200 bg-slate-950/95 p-3 text-left">
      <pre className="m-0 min-h-full overflow-visible text-[12px] leading-5 text-slate-100">
        <code
          className={`hljs${language.highlight ? ` language-${language.highlight}` : ""}`}
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      </pre>
    </div>
  );
}

