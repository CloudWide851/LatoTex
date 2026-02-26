const LATEX_EXTENSIONS = [".tex", ".bib", ".sty", ".cls", ".bst", ".bbx", ".cbx", ".ltx", ".tikz", ".pgf"];

export type SearchReplaceEdit = {
  path?: string;
  search: string;
  replace: string;
};

export type CandidateResolveResult = {
  candidate: string | null;
  appliedEdits: number;
  failedReason: "none" | "match_failed" | "no_target_edits";
};

export function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\/+/, "").trim();
}

export function isLatexPath(path: string): boolean {
  const normalized = normalizePath(path).toLowerCase();
  return LATEX_EXTENSIONS.some((ext) => normalized.endsWith(ext));
}

function extractMentionedPath(prompt: string): string | null {
  const matches = prompt.match(/[A-Za-z0-9_.\-\/\\]+\.[A-Za-z0-9]{1,8}/g);
  if (!matches || matches.length === 0) {
    return null;
  }
  for (const item of matches) {
    const normalized = normalizePath(item);
    if (!normalized) {
      continue;
    }
    const lower = normalized.toLowerCase();
    if (lower.startsWith("http://") || lower.startsWith("https://")) {
      continue;
    }
    return normalized;
  }
  return null;
}

export function pickTargetPath(prompt: string, selectedFile: string | null): {
  targetPath: string;
  explicitPath: boolean;
} {
  const mentioned = extractMentionedPath(prompt);
  if (mentioned) {
    return { targetPath: mentioned, explicitPath: true };
  }
  if (selectedFile && isLatexPath(selectedFile)) {
    return { targetPath: selectedFile, explicitPath: false };
  }
  return { targetPath: "main.tex", explicitPath: false };
}

export function extractFencedLatex(raw: string): string | null {
  const fenced = raw.match(/```(?:latex|tex)\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    const candidate = fenced[1].trim();
    return candidate.length > 0 ? candidate : null;
  }
  const genericFenced = raw.match(/```[\w-]*\s*([\s\S]*?)```/i);
  if (genericFenced?.[1]) {
    const candidate = genericFenced[1].trim();
    if (candidate.includes("\\documentclass") || candidate.includes("\\begin{document}")) {
      return candidate;
    }
  }
  if (raw.includes("\\documentclass") && raw.includes("\\begin{document}")) {
    return raw.trim();
  }
  return null;
}

function parseEditsInBlock(block: string): SearchReplaceEdit[] {
  const edits: SearchReplaceEdit[] = [];
  const pathMatch = block.match(/^\s*path\s*[:=]\s*([^\n\r]+)\s*$/im);
  const path = pathMatch?.[1]
    ? normalizePath(pathMatch[1].trim().replace(/^["'`]+|["'`]+$/g, ""))
    : undefined;
  const regex =
    /<<<<<<<\s*SEARCH\s*\n([\s\S]*?)\n=======\s*\n([\s\S]*?)\n>>>>>>>\s*REPLACE/gm;
  let match: RegExpExecArray | null = regex.exec(block);
  while (match) {
    edits.push({
      path,
      search: match[1] ?? "",
      replace: match[2] ?? "",
    });
    match = regex.exec(block);
  }
  return edits;
}

export function parseSearchReplaceEdits(raw: string): SearchReplaceEdit[] {
  const source = raw.replace(/\r\n/g, "\n");
  const edits: SearchReplaceEdit[] = [];
  const blocks: string[] = [];
  const fenceRegex = /```(?:edit|patch)\s*([\s\S]*?)```/gi;
  let fenceMatch: RegExpExecArray | null = fenceRegex.exec(source);
  while (fenceMatch) {
    blocks.push(fenceMatch[1] ?? "");
    fenceMatch = fenceRegex.exec(source);
  }
  if (blocks.length === 0) {
    blocks.push(source);
  }
  for (const block of blocks) {
    edits.push(...parseEditsInBlock(block));
  }
  return edits;
}

function escapeRegex(source: string): string {
  return source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceAt(content: string, start: number, length: number, nextText: string): string {
  return `${content.slice(0, start)}${nextText}${content.slice(start + length)}`;
}

function applySingleEdit(content: string, search: string, replace: string): string | null {
  if (!search) {
    return null;
  }
  const exactIndex = content.indexOf(search);
  if (exactIndex >= 0) {
    return replaceAt(content, exactIndex, search.length, replace);
  }

  const contentLf = content.replace(/\r\n/g, "\n");
  const searchLf = search.replace(/\r\n/g, "\n");
  const replaceLf = replace.replace(/\r\n/g, "\n");
  const lfIndex = contentLf.indexOf(searchLf);
  if (lfIndex >= 0) {
    return replaceAt(contentLf, lfIndex, searchLf.length, replaceLf);
  }

  const trimmedSearch = searchLf.trim();
  if (!trimmedSearch) {
    return null;
  }
  const tokens = trimmedSearch.split(/\s+/).filter((value) => value.length > 0);
  if (tokens.length === 0) {
    return null;
  }
  const pattern = new RegExp(tokens.map((value) => escapeRegex(value)).join("\\s+"), "gm");
  const matches = Array.from(contentLf.matchAll(pattern));
  if (matches.length !== 1 || matches[0].index === undefined) {
    return null;
  }
  return replaceAt(contentLf, matches[0].index, matches[0][0].length, replaceLf);
}

function applyEditsToContent(content: string, edits: SearchReplaceEdit[]): {
  candidate: string | null;
  applied: number;
} {
  let current = content;
  let applied = 0;
  for (const edit of edits) {
    const next = applySingleEdit(current, edit.search, edit.replace);
    if (next === null) {
      return { candidate: null, applied };
    }
    current = next;
    applied += 1;
  }
  return { candidate: current, applied };
}

export function resolveCandidateFromOutput(params: {
  output: string;
  targetPath: string;
  baseContent: string;
}): CandidateResolveResult {
  const { output, targetPath, baseContent } = params;
  const target = normalizePath(targetPath);
  const edits = parseSearchReplaceEdits(output);
  if (edits.length > 0) {
    const relevant = edits.filter((edit) => {
      const editPath = normalizePath(edit.path ?? target);
      return editPath === target;
    });
    if (relevant.length === 0) {
      return { candidate: null, appliedEdits: 0, failedReason: "no_target_edits" };
    }
    const applied = applyEditsToContent(baseContent, relevant);
    if (applied.candidate === null) {
      return { candidate: null, appliedEdits: applied.applied, failedReason: "match_failed" };
    }
    return { candidate: applied.candidate, appliedEdits: applied.applied, failedReason: "none" };
  }

  const fallback = extractFencedLatex(output);
  if (!fallback) {
    return { candidate: null, appliedEdits: 0, failedReason: "no_target_edits" };
  }
  return { candidate: fallback, appliedEdits: 0, failedReason: "none" };
}

export function computeDiffStats(originalContent: string, candidateContent: string): {
  insertions: number;
  deletions: number;
  changedLines: number[];
} {
  const original = originalContent.split(/\r?\n/);
  const candidate = candidateContent.split(/\r?\n/);
  const maxLen = Math.max(original.length, candidate.length);
  const changedLines: number[] = [];
  let insertions = 0;
  let deletions = 0;
  for (let index = 0; index < maxLen; index += 1) {
    const before = original[index] ?? "";
    const after = candidate[index] ?? "";
    if (before === after) {
      continue;
    }
    changedLines.push(index + 1);
    if (!before && after) {
      insertions += 1;
    } else if (before && !after) {
      deletions += 1;
    } else {
      insertions += 1;
      deletions += 1;
    }
  }
  return { insertions, deletions, changedLines: changedLines.slice(0, 120) };
}
