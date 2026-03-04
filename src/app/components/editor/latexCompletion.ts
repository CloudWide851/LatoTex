import { getEvents, runAgentStart } from "../../../shared/api/desktop";

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
const REMOTE_COMPLETION_TIMEOUT_MS = 4_500;
const REMOTE_COMPLETION_TTL_MS = 18_000;
const REMOTE_COMPLETION_MAX = 6;

type LatexCompletionContext = {
  projectId: string | null;
  selectedFile: string | null;
  completionModelId: string | null;
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
});

const remoteSuggestionCache = new Map<
  string,
  { expiresAt: number; suggestions: RemoteSuggestion[] }
>();
const remoteSuggestionInFlight = new Map<string, Promise<RemoteSuggestion[]>>();
const remoteProviderBackoffUntil = new Map<string, number>();

export function configureLatexCompletionRuntime(getter: () => LatexCompletionContext) {
  completionContextProvider = getter;
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
  let cursor = 0;
  const startedAt = Date.now();
  let deltaOutput = "";
  while (Date.now() - startedAt < REMOTE_COMPLETION_TIMEOUT_MS) {
    const batch = await getEvents(cursor, 120, runId);
    cursor = batch.nextCursor;
    for (const event of batch.events) {
      const payload = event.payload ?? {};
      if (event.kind === "responses.output_text.delta") {
        const delta = typeof payload.content === "string" ? payload.content : "";
        deltaOutput += delta;
      } else if (event.kind === "agent.run.completed") {
        const finalOutput = typeof payload.output === "string" ? payload.output : deltaOutput;
        return finalOutput || deltaOutput;
      } else if (event.kind === "agent.run.failed") {
        throw new Error("agent.run.failed");
      } else if (event.kind === "agent.run.cancelled") {
        throw new Error("agent.run.cancelled");
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 180));
  }
  throw new Error("agent.run.timeout");
}

async function fetchRemoteSuggestions(params: {
  linePrefix: string;
  fullText: string;
}): Promise<RemoteSuggestion[]> {
  const { projectId, selectedFile, completionModelId } = completionContextProvider();
  if (!projectId || !completionModelId) {
    return [];
  }
  const backoffUntil = remoteProviderBackoffUntil.get(projectId) ?? 0;
  if (backoffUntil > Date.now()) {
    return [];
  }
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
        "Current document context (tail):",
        params.fullText.slice(Math.max(0, params.fullText.length - 1400)),
      ].join("\n");
      const accepted = await runAgentStart({
        projectId,
        role: "completion",
        prompt,
        contextRefs: selectedFile ? [`file:${selectedFile}`] : [],
        modelOverride: completionModelId,
        bypassCache: false,
      });
      const output = await waitCompletionRunOutput(accepted.runId);
      const suggestions = parseRemoteSuggestions(output);
      remoteSuggestionCache.set(cacheKey, {
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
    async provideCompletionItems(model: any, position: any) {
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

      return { suggestions };
    },
  });
}
