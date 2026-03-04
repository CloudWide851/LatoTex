const LATEX_COMMAND_SNIPPETS: Array<{ label: string; insertText: string }> = [
  { label: "\\section", insertText: "\\section{${1}}" },
  { label: "\\subsection", insertText: "\\subsection{${1}}" },
  { label: "\\subsubsection", insertText: "\\subsubsection{${1}}" },
  { label: "\\paragraph", insertText: "\\paragraph{${1}}" },
  { label: "\\textbf", insertText: "\\textbf{${1}}" },
  { label: "\\textit", insertText: "\\textit{${1}}" },
  { label: "\\emph", insertText: "\\emph{${1}}" },
  { label: "\\underline", insertText: "\\underline{${1}}" },
  { label: "\\item", insertText: "\\item ${1}" },
  { label: "\\label", insertText: "\\label{${1}}" },
  { label: "\\ref", insertText: "\\ref{${1}}" },
  { label: "\\eqref", insertText: "\\eqref{${1}}" },
  { label: "\\cite", insertText: "\\cite{${1}}" },
  { label: "\\citep", insertText: "\\citep{${1}}" },
  { label: "\\citet", insertText: "\\citet{${1}}" },
  { label: "\\frac", insertText: "\\frac{${1}}{${2}}" },
  { label: "\\sqrt", insertText: "\\sqrt{${1}}" },
  { label: "\\begin{equation}", insertText: "\\begin{equation}\n\t${1}\n\\end{equation}" },
  { label: "\\begin{align}", insertText: "\\begin{align}\n\t${1}\n\\end{align}" },
  { label: "\\begin{itemize}", insertText: "\\begin{itemize}\n\t\\item ${1}\n\\end{itemize}" },
  { label: "\\begin{enumerate}", insertText: "\\begin{enumerate}\n\t\\item ${1}\n\\end{enumerate}" },
  { label: "\\begin{table}", insertText: "\\begin{table}[htbp]\n\t\\centering\n\t${1}\n\\end{table}" },
  { label: "\\begin{figure}", insertText: "\\begin{figure}[htbp]\n\t\\centering\n\t${1}\n\\end{figure}" },
];

const LATEX_ENVIRONMENTS = [
  "equation",
  "align",
  "align*",
  "itemize",
  "enumerate",
  "table",
  "figure",
  "tabular",
  "theorem",
  "lemma",
  "proof",
  "center",
  "flushleft",
  "flushright",
];

const registeredMonaco = new WeakSet<object>();

function collectUniqueMatches(text: string, pattern: RegExp): string[] {
  const out = new Set<string>();
  let match: RegExpExecArray | null = null;
  while ((match = pattern.exec(text)) !== null) {
    const value = String(match[1] ?? "").trim();
    if (value) {
      out.add(value);
    }
  }
  return Array.from(out).slice(0, 300);
}

function collectCiteKeys(text: string): string[] {
  const fromBibItem = collectUniqueMatches(text, /\\bibitem\{([^}]+)\}/g);
  const fromCite = collectUniqueMatches(text, /\\cite[a-zA-Z*]*\{([^}]+)\}/g)
    .flatMap((item) => item.split(","))
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const merged = new Set<string>([...fromBibItem, ...fromCite]);
  return Array.from(merged).slice(0, 300);
}

function collectLabelKeys(text: string): string[] {
  return collectUniqueMatches(text, /\\label\{([^}]+)\}/g);
}

function buildReplaceRange(monaco: any, model: any, position: any) {
  const word = model.getWordUntilPosition(position);
  return new monaco.Range(
    position.lineNumber,
    word.startColumn,
    position.lineNumber,
    word.endColumn,
  );
}

export function ensureLatexCompletionProvider(monaco: any) {
  if (!monaco || typeof monaco !== "object") {
    return;
  }
  if (registeredMonaco.has(monaco)) {
    return;
  }
  registeredMonaco.add(monaco);

  monaco.languages.registerCompletionItemProvider("latex", {
    triggerCharacters: ["\\", "{", ","],
    provideCompletionItems(model: any, position: any) {
      const text = String(model.getValue() ?? "");
      const linePrefix = String(model.getLineContent(position.lineNumber) ?? "").slice(0, Math.max(0, position.column - 1));
      const replaceRange = buildReplaceRange(monaco, model, position);
      const inRef = /\\(?:auto)?ref\{[^}]*$/i.test(linePrefix);
      const inCite = /\\cite[a-zA-Z*]*\{[^}]*$/i.test(linePrefix);
      const inBegin = /\\begin\{[^}]*$/i.test(linePrefix);
      const inCommand = /\\[A-Za-z]*$/.test(linePrefix);
      const suggestions: any[] = [];

      if (inRef) {
        for (const key of collectLabelKeys(text)) {
          suggestions.push({
            label: key,
            kind: monaco.languages.CompletionItemKind.Reference,
            insertText: key,
            range: replaceRange,
          });
        }
      }

      if (inCite) {
        for (const key of collectCiteKeys(text)) {
          suggestions.push({
            label: key,
            kind: monaco.languages.CompletionItemKind.Reference,
            insertText: key,
            range: replaceRange,
          });
        }
      }

      if (inBegin) {
        for (const env of LATEX_ENVIRONMENTS) {
          suggestions.push({
            label: env,
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: env,
            range: replaceRange,
          });
        }
      }

      if (inCommand || suggestions.length === 0) {
        for (const command of LATEX_COMMAND_SNIPPETS) {
          suggestions.push({
            label: command.label,
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: command.insertText,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range: replaceRange,
          });
        }
      }

      return { suggestions };
    },
  });
}
