function normalizePath(value: string): string {
  return String(value || "").trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

export function resolveDroppedPromptRefs(
  paths: string[],
  candidateFiles: string[],
  options?: { allowUnmatched?: boolean },
): string[] {
  const allowUnmatched = options?.allowUnmatched ?? true;
  const normalizedCandidates = candidateFiles.map((item) => normalizePath(item));
  const byPath = new Map<string, string>();
  const byName = new Map<string, string[]>();

  for (let index = 0; index < normalizedCandidates.length; index += 1) {
    const normalized = normalizedCandidates[index];
    const original = candidateFiles[index];
    byPath.set(normalized, original);
    const name = normalized.split("/").pop()?.toLowerCase() ?? normalized.toLowerCase();
    const list = byName.get(name) ?? [];
    list.push(original);
    byName.set(name, list);
  }

  const resolved = new Set<string>();
  for (const item of paths) {
    const normalized = normalizePath(item);
    if (!normalized) {
      continue;
    }
    const exact = byPath.get(normalized);
    if (exact) {
      resolved.add(exact);
      continue;
    }
    const name = normalized.split("/").pop()?.toLowerCase() ?? "";
    const byFileName = byName.get(name) ?? [];
    if (byFileName.length === 1) {
      resolved.add(byFileName[0]);
      continue;
    }
    if (allowUnmatched) {
      resolved.add(normalized);
    }
  }

  return Array.from(resolved);
}

export function appendPromptRefs(basePrompt: string, resolvedPaths: string[], applyRef: (prompt: string, path: string) => string): string {
  let nextPrompt = basePrompt;
  for (const path of resolvedPaths) {
    nextPrompt = applyRef(nextPrompt, path);
  }
  return nextPrompt;
}