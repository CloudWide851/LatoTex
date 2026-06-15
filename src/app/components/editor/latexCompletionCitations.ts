import { loadLocalCitationSuggestions } from "../../hooks/researchCitationLookup";

type LatexCompletionContext = {
  projectId: string | null;
  selectedFile: string | null;
  fileList: string[];
};

function citationPrefixFromLine(linePrefix: string): string {
  const match = linePrefix.match(/\\cite[a-zA-Z*]*\s*(?:\[[^\]]*])*\s*\{([^}]*)$/i);
  const value = String(match?.[1] ?? "");
  return value.split(",").pop()?.trim() ?? "";
}

function buildCitationReplaceRange(monaco: any, position: any, linePrefix: string) {
  const prefix = citationPrefixFromLine(linePrefix);
  const startColumn = Math.max(1, position.column - prefix.length);
  return new monaco.Range(
    position.lineNumber,
    startColumn,
    position.lineNumber,
    position.column,
  );
}

export async function buildCitationCompletionItems(input: {
  monaco: any;
  position: any;
  linePrefix: string;
  text: string;
  context: LatexCompletionContext;
  fallbackKeys: string[];
}): Promise<any[]> {
  const { monaco, position, linePrefix, text, context, fallbackKeys } = input;
  const range = buildCitationReplaceRange(monaco, position, linePrefix);
  const suggestions: any[] = [];
  try {
    const localCitations = await loadLocalCitationSuggestions({
      projectId: context.projectId,
      selectedFile: context.selectedFile,
      texSource: text,
      fileList: context.fileList,
      prefix: citationPrefixFromLine(linePrefix),
      limit: 40,
    });
    for (const item of localCitations) {
      suggestions.push({
        label: item.key,
        kind: monaco.languages.CompletionItemKind.Reference,
        detail: item.title || item.sourcePath,
        documentation: [item.author, item.year, item.sourcePath].filter(Boolean).join(" · "),
        insertText: item.key,
        range,
      });
    }
  } catch {
    // Keep citation completion local-first and non-blocking when Bib files are unreadable.
  }
  for (const key of fallbackKeys) {
    suggestions.push({
      label: key,
      kind: monaco.languages.CompletionItemKind.Reference,
      insertText: key,
      range,
    });
  }
  return suggestions;
}
