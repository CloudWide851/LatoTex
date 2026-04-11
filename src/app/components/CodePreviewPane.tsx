import { useMemo } from "react";
import type { CodeLanguageInfo } from "../../shared/utils/codeLanguage";
import { resolveCodeLanguage, resolveCodeLanguageTag } from "../../shared/utils/codeLanguage";
import { renderCodePreviewHtml } from "./codePreviewHighlight";

export function CodePreviewPane(props: {
  filePath: string | null;
  codeContent: string;
  emptyText: string;
  language?: CodeLanguageInfo;
  languageTag?: string;
}) {
  const { filePath, codeContent, emptyText, language: providedLanguage, languageTag: providedLanguageTag } = props;
  const language = useMemo(() => providedLanguage ?? resolveCodeLanguage(filePath), [filePath, providedLanguage]);
  const languageTag = useMemo(() => providedLanguageTag ?? resolveCodeLanguageTag(filePath), [filePath, providedLanguageTag]);
  const highlighted = useMemo(() => {
    const source = String(codeContent ?? "");
    return renderCodePreviewHtml(source, language, languageTag, filePath);
  }, [codeContent, filePath, language, languageTag]);

  if (!String(codeContent ?? "").trim()) {
    return (
      <div className="flex h-full items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
        {emptyText}
      </div>
    );
  }

  return (
    <div
      className={`h-full overflow-auto rounded border p-3 text-left ${
        language.highlight
          ? "border-slate-200 bg-slate-950/95"
          : "border-[color:var(--editor-widget-border)] bg-[color:var(--editor-widget-bg)]"
      }`}
    >
      <pre
        className={`m-0 min-h-full overflow-visible text-[12px] leading-5 ${
          language.highlight ? "text-slate-100" : "text-[color:var(--editor-tab-text)]"
        }`}
      >
        <code
          data-language-tag={languageTag}
          className={`hljs${language.highlight ? ` language-${language.highlight}` : ""}`}
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      </pre>
    </div>
  );
}
