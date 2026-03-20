function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\/+/, "").trim();
}

type RefToken = {
  raw: string;
  value: string;
};

export function extractPromptRefTokens(prompt: string): RefToken[] {
  const out: RefToken[] = [];
  const pattern = /@(?:"([^"]+)"|([^\s@]+))/g;
  let match: RegExpExecArray | null = pattern.exec(prompt);
  while (match) {
    const value = normalizePath(String(match[1] ?? match[2] ?? ""));
    if (value) {
      out.push({
        raw: String(match[0] ?? ""),
        value,
      });
    }
    match = pattern.exec(prompt);
  }
  return out;
}

export function extractPromptRefValues(prompt: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of extractPromptRefTokens(prompt)) {
    const value = token.value;
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    out.push(value);
  }
  return out;
}

function basenameOf(path: string): string {
  const normalized = normalizePath(path);
  const parts = normalized.split("/");
  return parts[parts.length - 1] ?? normalized;
}

export function resolvePromptInputFiles(prompt: string, candidateFiles: string[]): {
  resolved: string[];
  unresolved: string[];
} {
  const tokens = extractPromptRefTokens(prompt);
  if (tokens.length === 0) {
    return { resolved: [], unresolved: [] };
  }
  const normalizedCandidates = candidateFiles.map((item) => normalizePath(item));
  const byPath = new Map<string, string>();
  for (let i = 0; i < normalizedCandidates.length; i += 1) {
    byPath.set(normalizedCandidates[i], candidateFiles[i]);
  }
  const byName = new Map<string, string[]>();
  for (let i = 0; i < normalizedCandidates.length; i += 1) {
    const name = basenameOf(normalizedCandidates[i]).toLowerCase();
    const list = byName.get(name) ?? [];
    list.push(candidateFiles[i]);
    byName.set(name, list);
  }

  const resolvedSet = new Set<string>();
  for (const token of tokens) {
    const exact = byPath.get(token.value);
    if (exact) {
      resolvedSet.add(exact);
      continue;
    }
    const byFileName = byName.get(basenameOf(token.value).toLowerCase()) ?? [];
    if (byFileName.length === 1) {
      resolvedSet.add(byFileName[0]);
    }
  }
  return {
    resolved: Array.from(resolvedSet),
    unresolved: [],
  };
}

export function extractTrailingAtQuery(prompt: string): string | null {
  const match = prompt.match(/(?:^|\s)@(?:"([^"]*)"?|([^\s"]*))$/);
  if (!match) {
    return null;
  }
  return normalizePath(String(match[1] ?? match[2] ?? ""));
}

function quoteIfNeeded(path: string): string {
  return /\s/.test(path) ? `@"${path}"` : `@${path}`;
}

export function applyPromptRefSuggestion(prompt: string, path: string): string {
  const replacement = `${quoteIfNeeded(normalizePath(path))} `;
  const matched = /(?:^|\s)@(?:"([^"]*)"?|([^\s"]*))$/.exec(prompt);
  if (!matched || matched.index == null) {
    if (!prompt.trim()) {
      return replacement;
    }
    return `${prompt.trimEnd()} ${replacement}`;
  }
  const prefix = prompt.slice(0, matched.index);
  return `${prefix}${prefix.endsWith(" ") || prefix.length === 0 ? "" : " "}${replacement}`;
}

export function suggestPromptRefs(
  prompt: string,
  candidateFiles: string[],
  limit = 12,
): string[] {
  const query = extractTrailingAtQuery(prompt);
  if (query == null) {
    return [];
  }
  const normalizedQuery = query.toLowerCase();
  const sorted = [...candidateFiles].sort((a, b) => a.localeCompare(b));
  if (!normalizedQuery) {
    return sorted.slice(0, limit);
  }
  return sorted
    .filter((item) => item.toLowerCase().includes(normalizedQuery))
    .slice(0, limit);
}