function normalizeQuery(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length < 3 || trimmed.length > 180) {
    return null;
  }
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    return null;
  }
  return trimmed;
}

export function buildToolSearchQueryBlock(queries: string[]): string {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const item of queries) {
    const normalized = normalizeQuery(item);
    if (!normalized) {
      continue;
    }
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(normalized);
    if (unique.length >= 10) {
      break;
    }
  }
  const lines = unique.length > 0 ? unique.map((item) => `- ${item}`) : ["- latex citation verification"];
  return ["[tool_search.queries.v1]", ...lines].join("\n");
}
