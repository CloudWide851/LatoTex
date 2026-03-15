export function resolveDroppedPromptRefs(paths: string[], candidateFiles: string[]): string[] {
  const normalizedCandidates = candidateFiles.map((item) => item.replace(/\\/g, "/"));
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
    const normalized = String(item || "").trim().replace(/\\/g, "/");
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
