import type { AgentDiffBlock } from "./agentTypes";

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

type DiffOp =
  | { type: "equal"; oldLine: number; newLine: number }
  | { type: "add"; newLine: number }
  | { type: "remove"; oldLine: number };

function computeDiffOps(original: string[], candidate: string[]): DiffOp[] {
  const n = original.length;
  const m = candidate.length;
  const max = n + m;
  const offset = max;
  const trace: number[][] = [];
  let v = new Array(2 * max + 1).fill(-1);
  v[offset + 1] = 0;

  for (let d = 0; d <= max; d += 1) {
    const next = v.slice();
    for (let k = -d; k <= d; k += 2) {
      const kIndex = offset + k;
      const goDown = k === -d || (k !== d && v[kIndex - 1] < v[kIndex + 1]);
      let x = goDown ? v[kIndex + 1] : v[kIndex - 1] + 1;
      let y = x - k;
      while (x < n && y < m && original[x] === candidate[y]) {
        x += 1;
        y += 1;
      }
      next[kIndex] = x;
      if (x >= n && y >= m) {
        trace.push(next);
        return backtrackDiff(trace, original, candidate, offset);
      }
    }
    trace.push(next);
    v = next;
  }
  return [];
}

function backtrackDiff(trace: number[][], original: string[], candidate: string[], offset: number): DiffOp[] {
  let x = original.length;
  let y = candidate.length;
  const result: DiffOp[] = [];

  for (let d = trace.length - 1; d >= 0; d -= 1) {
    const k = x - y;
    const v = trace[d];
    const goDown = d > 0 && (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]));
    const prevK = d === 0 ? 0 : goDown ? k + 1 : k - 1;
    const prevX = d === 0 ? 0 : trace[d - 1][offset + prevK];
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      result.push({ type: "equal", oldLine: x, newLine: y });
      x -= 1;
      y -= 1;
    }
    if (d === 0) {
      break;
    }
    if (x === prevX) {
      result.push({ type: "add", newLine: y });
      y -= 1;
    } else {
      result.push({ type: "remove", oldLine: x });
      x -= 1;
    }
  }

  return result.reverse();
}

function collectChangedLines(blocks: AgentDiffBlock[], candidateLineCount: number): number[] {
  const values = new Set<number>();
  for (const block of blocks) {
    if (block.kind === "delete") {
      values.add(Math.max(1, Math.min(candidateLineCount || 1, block.lineStart)));
      continue;
    }
    for (let line = block.lineStart; line <= block.lineEnd; line += 1) {
      values.add(line);
      if (values.size >= 240) {
        break;
      }
    }
    if (values.size >= 240) {
      break;
    }
  }
  return Array.from(values).sort((a, b) => a - b).slice(0, 120);
}

function buildDiffBlocks(ops: DiffOp[], candidateLineCount: number): AgentDiffBlock[] {
  const blocks: AgentDiffBlock[] = [];
  let index = 0;
  while (index < ops.length) {
    if (ops[index].type === "equal") {
      index += 1;
      continue;
    }
    const start = index;
    while (index < ops.length && ops[index].type !== "equal") {
      index += 1;
    }
    const segment = ops.slice(start, index);
    const insertions = segment.filter((item) => item.type === "add").length;
    const deletions = segment.filter((item) => item.type === "remove").length;
    const addedLines = segment
      .filter((item): item is Extract<DiffOp, { type: "add" }> => item.type === "add")
      .map((item) => item.newLine);

    if (insertions > 0) {
      blocks.push({
        kind: deletions > 0 ? "modify" : "add",
        lineStart: Math.min(...addedLines),
        lineEnd: Math.max(...addedLines),
        insertions,
        deletions,
      });
      continue;
    }

    const previousEqual = [...ops.slice(0, start)].reverse().find((item) => item.type === "equal") as
      | Extract<DiffOp, { type: "equal" }>
      | undefined;
    const nextEqual = ops.slice(index).find((item) => item.type === "equal") as
      | Extract<DiffOp, { type: "equal" }>
      | undefined;
    const anchor = nextEqual?.newLine ?? previousEqual?.newLine ?? 1;
    const clampedAnchor = Math.max(1, Math.min(candidateLineCount || 1, anchor));
    blocks.push({
      kind: "delete",
      lineStart: clampedAnchor,
      lineEnd: clampedAnchor,
      insertions: 0,
      deletions,
    });
  }
  return blocks;
}

export function computeDiffStats(originalContent: string, candidateContent: string): {
  insertions: number;
  deletions: number;
  changedLines: number[];
  diffBlocks: AgentDiffBlock[];
} {
  const original = originalContent.replace(/\r\n/g, "\n").split("\n");
  const candidate = candidateContent.replace(/\r\n/g, "\n").split("\n");
  const ops = computeDiffOps(original, candidate);
  const insertions = ops.filter((item) => item.type === "add").length;
  const deletions = ops.filter((item) => item.type === "remove").length;
  const diffBlocks = buildDiffBlocks(ops, candidate.length);
  const changedLines = collectChangedLines(diffBlocks, candidate.length);
  return { insertions, deletions, changedLines, diffBlocks };
}
