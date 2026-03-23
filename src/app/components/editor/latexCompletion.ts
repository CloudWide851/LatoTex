import { executeWorkflowStart } from "../../../shared/api/agent";
import { waitForRunOutputWithPolicy } from "../../hooks/runEventWait";
import { getIndexedProjectSymbols, scheduleProjectSymbolIndexSync } from "./latexProjectSymbolIndex";

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
const REMOTE_COMPLETION_TTL_MS = 18_000;
const REMOTE_COMPLETION_MAX = 6;
const REMOTE_COMPLETION_CACHE_MAX_KEYS = 220;
const REMOTE_PROVIDER_BACKOFF_MAX_KEYS = 80;

type LatexCompletionContext = {
  projectId: string | null;
  selectedFile: string | null;
  completionModelId: string | null;
  fileList: string[];
  selectedFileContent: string;
};

type RemoteSuggestion = {
  label: string;
  insertText: string;
  kind: "snippet" | "text";
};

let completionContextProvider: () => LatexCompletionContext = () => ({
  projectId: null,
  selectedFile: null,
  completionModelId: null,
  fileList: [],
  selectedFileContent: "",
});

const remoteSuggestionCache = new Map<
  string,
  { expiresAt: number; suggestions: RemoteSuggestion[] }
>();
const remoteSuggestionInFlight = new Map<string, Promise<RemoteSuggestion[]>>();
const remoteProviderBackoffUntil = new Map<string, number>();

function pruneRemoteCompletionCaches(now = Date.now()) {
  for (const [key, value] of remoteSuggestionCache.entries()) {
    if (value.expiresAt <= now) {
      remoteSuggestionCache.delete(key);
    }
  }
  while (remoteSuggestionCache.size > REMOTE_COMPLETION_CACHE_MAX_KEYS) {
    const oldest = remoteSuggestionCache.keys().next().value;
    if (!oldest) {
      break;
    }
    remoteSuggestionCache.delete(oldest);
  }
  for (const [key, backoffUntil] of remoteProviderBackoffUntil.entries()) {
    if (backoffUntil <= now) {
      remoteProviderBackoffUntil.delete(key);
    }
  }
  while (remoteProviderBackoffUntil.size > REMOTE_PROVIDER_BACKOFF_MAX_KEYS) {
    const oldest = remoteProviderBackoffUntil.keys().next().value;
    if (!oldest) {
      break;
    }
    remoteProviderBackoffUntil.delete(oldest);
  }
}

function setRemoteSuggestionCache(
  cacheKey: string,
  value: { expiresAt: number; suggestions: RemoteSuggestion[] },
) {
  if (remoteSuggestionCache.has(cacheKey)) {
    remoteSuggestionCache.delete(cacheKey);
  }
  remoteSuggestionCache.set(cacheKey, value);
  pruneRemoteCompletionCaches();
}

export function configureLatexCompletionRuntime(getter: () => LatexCompletionContext) {
  completionContextProvider = getter;
  const context = getter();
  scheduleProjectSymbolIndexSync({
    projectId: context.projectId,
    fileList: context.fileList,
    selectedFile: context.selectedFile,
    selectedFileContent: context.selectedFileContent,
  });
}

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

function dedupeRemoteSuggestions(items: RemoteSuggestion[]): RemoteSuggestion[] {
  const seen = new Set<string>();
  const out: RemoteSuggestion[] = [];
  for (const item of items) {
    const key = `${item.label}::${item.insertText}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(item);
    if (out.length >= REMOTE_COMPLETION_MAX) {
      break;
    }
  }
  return out;
}

function extractJsonCandidates(raw: string): string[] {
  const out: string[] = [];
  const trimmed = raw.trim();
  if (!trimmed) {
    return out;
  }
  out.push(trimmed);
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/gi) ?? [];
  for (const block of fenced) {
    const parsed = block.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
    if (parsed) {
      out.push(parsed);
    }
  }
  return out;
}

function toRemoteSuggestion(value: unknown): RemoteSuggestion | null {
  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized || !normalized.startsWith("\\")) {
      return null;
    }
    return {
      label: normalized,
      insertText: normalized,
      kind: normalized.includes("${") ? "snippet" : "text",
    };
  }
  if (!value || typeof value !== "object") {
    return null;
  }
  const obj = value as Record<string, unknown>;
  const label = String(obj.label ?? obj.insertText ?? "").trim();
  const insertText = String(obj.insertText ?? obj.label ?? "").trim();
  if (!label || !insertText || !label.startsWith("\\")) {
    return null;
  }
  const kindValue = String(obj.kind ?? "").toLowerCase();
  const kind: "snippet" | "text" = kindValue === "snippet" || insertText.includes("${")
    ? "snippet"
    : "text";
  return {
    label,
    insertText,
    kind,
  };
}

function parseRemoteSuggestions(raw: string): RemoteSuggestion[] {
  const candidates = extractJsonCandidates(raw);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const list = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).suggestions)
          ? ((parsed as Record<string, unknown>).suggestions as unknown[])
          : [];
      const normalized = dedupeRemoteSuggestions(
        list
          .map((item) => toRemoteSuggestion(item))
          .filter((item): item is RemoteSuggestion => Boolean(item)),
      );
      if (normalized.length > 0) {
        return normalized;
      }
    } catch {
      // Continue trying other candidates.
    }
  }

  const fallback = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("\\"))
    .map((line) => toRemoteSuggestion(line))
    .filter((item): item is RemoteSuggestion => Boolean(item));
  return dedupeRemoteSuggestions(fallback);
}

async function waitCompletionRunOutput(runId: string): Promise<string> {
  return waitForRunOutputWithPolicy({
    runId,
    totalTimeoutMs: 12_000,
    inactivityTimeoutMs: 4_000,
    eventLimit: 120,
    waitMs: 1_200,
    idleDelayMs: 90,
  });
}

async function fetchRemoteSuggestions(params: {
  linePrefix: string;
  fullText: string;
}): Promise<RemoteSuggestion[]> {
  const {
    projectId,
    selectedFile,
    completionModelId,
    fileList,
    selectedFileContent,
  } = completionContextProvider();
  if (!projectId || !completionModelId) {
    return [];
  }
  const backoffUntil = remoteProviderBackoffUntil.get(projectId) ?? 0;
  if (backoffUntil > Date.now()) {
    return [];
  }
  pruneRemoteCompletionCaches();
  const focusedLine = params.linePrefix.trim();
  if (focusedLine.length < 2 || focusedLine.length > 180) {
    return [];
  }
  const cacheKey = `${projectId}::${selectedFile ?? "none"}::${focusedLine}`;
  const cached = remoteSuggestionCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.suggestions;
  }
  const pending = remoteSuggestionInFlight.get(cacheKey);
  if (pending) {
    return pending;
  }

  const fetchPromise = (async () => {
    try {
      const symbolHintPrefix = focusedLine.replace(/^.*?([\\A-Za-z_][A-Za-z0-9_:@-]*)$/, "$1");
      const projectSymbols = await getIndexedProjectSymbols({
        projectId,
        fileList,
        selectedFile,
        selectedFileContent,
        prefix: symbolHintPrefix.replace(/^\\/, ""),
        limit: 20,
      });
      const prompt = [
        "You are a LaTeX autocomplete engine.",
        "Return strict JSON only.",
        "Schema:",
        "{\"suggestions\":[{\"label\":\"\\\\command\",\"insertText\":\"\\\\command{${1}}\",\"kind\":\"snippet|text\"}]}",
        `Maximum ${REMOTE_COMPLETION_MAX} suggestions.`,
        "Only include suggestions that start with '\\\\' and match the current prefix.",
        "",
        "Current line prefix:",
        focusedLine,
        "",
        "Known project symbols (high confidence):",
        projectSymbols.join(", "),
        "",
        "Current document context (tail):",
        params.fullText.slice(Math.max(0, params.fullText.length - 720)),
      ].join("\n");
      const accepted = await executeWorkflowStart({
        projectId,
        workflowId: "completion.latex",
        callsite: "completion.inline",
        prompt,
        contextRefs: selectedFile ? [`file:${selectedFile}`] : [],
        modelOverride: completionModelId,
        bypassCache: false,
      });
      const output = await waitCompletionRunOutput(accepted.runId);
      const suggestions = parseRemoteSuggestions(output);
      setRemoteSuggestionCache(cacheKey, {
        expiresAt: Date.now() + REMOTE_COMPLETION_TTL_MS,
        suggestions,
      });
      return suggestions;
    } catch {
      // Backoff briefly if completion role is not configured or provider is unavailable.
      remoteProviderBackoffUntil.set(projectId, Date.now() + 20_000);
      return [];
    } finally {
      remoteSuggestionInFlight.delete(cacheKey);
    }
  })();
  remoteSuggestionInFlight.set(cacheKey, fetchPromise);
  return fetchPromise;
}

function wordPrefixFromLine(linePrefix: string): string {
  const match = linePrefix.match(/([\\A-Za-z_][A-Za-z0-9_:@-]*)$/);
  return match?.[1] ?? "";
}

function toSymbolCompletionItems(monaco: any, replaceRange: any, symbols: string[]): any[] {
  return symbols.map((symbol) => ({
    label: symbol,
    kind: symbol.startsWith("\\")
      ? monaco.languages.CompletionItemKind.Function
      : monaco.languages.CompletionItemKind.Text,
    insertText: symbol,
    range: replaceRange,
  }));
}

export function ensureLatexCompletionProvider(monaco: any) {
  if (!monaco || typeof monaco !== "object") {
    return;
  }
  if (registeredMonaco.has(monaco)) {
    return;
  }
  registeredMonaco.add(monaco);

  monaco.languages.registerInlineCompletionsProvider("latex", {
    async provideInlineCompletions(model: any, position: any) {
      const text = String(model.getValue() ?? "");
      const linePrefix = String(model.getLineContent(position.lineNumber) ?? "").slice(0, Math.max(0, position.column - 1));
      const prefix = wordPrefixFromLine(linePrefix);
      if (prefix.length < 2) {
        return { items: [] };
      }
      const context = completionContextProvider();
      scheduleProjectSymbolIndexSync({
        projectId: context.projectId,
        fileList: context.fileList,
        selectedFile: context.selectedFile,
        selectedFileContent: text,
      });
      const projectSymbols = await getIndexedProjectSymbols({
        projectId: context.projectId,
        fileList: context.fileList,
        selectedFile: context.selectedFile,
        selectedFileContent: text,
        prefix: prefix.replace(/^\\/, ""),
        limit: 8,
      });
      let candidate = projectSymbols.find((item) => item.startsWith(prefix) && item !== prefix) ?? null;
      if (!candidate && /\\[A-Za-z]{2,}$/.test(prefix)) {
        const remote = await fetchRemoteSuggestions({ linePrefix, fullText: text });
        candidate = remote
          .map((item) => item.insertText.replace(/\$\{\d+:?([^}]*)\}/g, "$1").replace(/\$\d+/g, ""))
          .find((item) => item.startsWith(prefix) && item !== prefix) ?? null;
      }
      if (!candidate) {
        return { items: [] };
      }
      const insertText = candidate.slice(prefix.length);
      if (!insertText) {
        return { items: [] };
      }
      return {
        items: [
          {
            insertText,
            range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
          },
        ],
      };
    },
    freeInlineCompletions: () => undefined,
  });

  monaco.languages.registerCompletionItemProvider("latex", {
    triggerCharacters: ["\\", "{", ","],
    async provideCompletionItems(model: any, position: any) {
      const text = String(model.getValue() ?? "");
      const linePrefix = String(model.getLineContent(position.lineNumber) ?? "").slice(0, Math.max(0, position.column - 1));
      const wordPrefix = wordPrefixFromLine(linePrefix);
      const replaceRange = buildReplaceRange(monaco, model, position);
      const inRef = /\\(?:auto)?ref\{[^}]*$/i.test(linePrefix);
      const inCite = /\\cite[a-zA-Z*]*\{[^}]*$/i.test(linePrefix);
      const inBegin = /\\begin\{[^}]*$/i.test(linePrefix);
      const inCommand = /\\[A-Za-z]*$/.test(linePrefix);
      const suggestions: any[] = [];
      const context = completionContextProvider();

      scheduleProjectSymbolIndexSync({
        projectId: context.projectId,
        fileList: context.fileList,
        selectedFile: context.selectedFile,
        selectedFileContent: text,
      });

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

      if (wordPrefix.length >= 2) {
        const projectSymbols = await getIndexedProjectSymbols({
          projectId: context.projectId,
          fileList: context.fileList,
          selectedFile: context.selectedFile,
          selectedFileContent: text,
          prefix: wordPrefix.replace(/^\\/, ""),
          limit: 40,
        });
        suggestions.push(...toSymbolCompletionItems(monaco, replaceRange, projectSymbols));
      }

      const shouldQueryRemote = /\\[A-Za-z]{2,}$/.test(linePrefix) || inRef || inCite || inBegin;
      if (shouldQueryRemote) {
        const remoteSuggestions = await fetchRemoteSuggestions({
          linePrefix,
          fullText: text,
        });
        for (const item of remoteSuggestions) {
          suggestions.push({
            label: item.label,
            kind:
              item.kind === "snippet"
                ? monaco.languages.CompletionItemKind.Snippet
                : monaco.languages.CompletionItemKind.Text,
            insertText: item.insertText,
            insertTextRules:
              item.kind === "snippet"
                ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                : undefined,
            range: replaceRange,
          });
        }
      }

      const deduped = new Map<string, any>();
      for (const item of suggestions) {
        const key = `${String(item.label)}::${String(item.insertText ?? "")}`;
        if (!deduped.has(key)) {
          deduped.set(key, item);
        }
      }
      return { suggestions: Array.from(deduped.values()) };
    },
  });
}


