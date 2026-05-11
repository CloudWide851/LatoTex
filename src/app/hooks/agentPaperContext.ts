import {
  getLibraryTree,
  importLibraryLink,
  libraryCitationResolve,
  libraryResolvePdfPreview,
} from "../../shared/api/library";
import type { ResourceNode } from "../../shared/types/app";
import { buildPaperAnalysisContext } from "./analysisDataSources";

export type AgentPaperResolution =
  | { status: "ok"; sourcePath: string }
  | { status: "missing_explicit" }
  | { status: "not_found"; ref: string }
  | { status: "ambiguous"; ref: string; matches: string[] };

export type AgentPaperLinkImportResult = {
  sourcePath: string;
  cachedPdfPath: string | null;
  sourceUrl: string | null;
  cached: boolean;
};

export type AgentPaperPromptAction = "import_only" | "analyze" | "translate" | "none";

function normalizePaperRef(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^\/+/, "")
    .replace(/^\.\/+/, "")
    .replace(/^\.latotex\/papers\/+?/i, "");
}

function flattenLibraryPaths(nodes: ResourceNode[], acc: string[] = []): string[] {
  for (const node of nodes) {
    if (node.kind === "file") {
      acc.push(node.relativePath.replace(/\\/g, "/"));
      continue;
    }
    if (node.kind === "directory" && Array.isArray(node.children)) {
      flattenLibraryPaths(node.children, acc);
    }
  }
  return acc;
}

function flattenLibraryPaperRefs(nodes: ResourceNode[], acc: string[] = []): string[] {
  const all = flattenLibraryPaths(nodes, []);
  for (const path of all) {
    if (/\.(pdf|bib)$/i.test(path)) {
      acc.push(path);
    }
  }
  return acc;
}

function extractExplicitPaperRef(prompt: string): string | null {
  const quotedMatch = prompt.match(/["'`]([^"'`]+?\.(?:pdf|bib))["'`]/i);
  if (quotedMatch?.[1]) {
    return normalizePaperRef(quotedMatch[1]);
  }
  const plainMatch = prompt.match(/[\p{L}\p{N}_\-./\\]+\.(?:pdf|bib)\b/iu);
  if (plainMatch?.[0]) {
    return normalizePaperRef(plainMatch[0]);
  }
  return null;
}

function normalizeCandidateLink(link: string): string {
  return link
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[)>\],.;]+$/g, "");
}

function extractUrlLink(prompt: string): string | null {
  const raw = prompt.match(/https?:\/\/[^\s]+/i)?.[0] ?? "";
  const normalized = normalizeCandidateLink(raw);
  return normalized || null;
}

function extractDoiLike(prompt: string): string | null {
  const doi = prompt.match(/\b10\.\d{4,9}\/[\w.()\-;:/]+\b/i)?.[0];
  return doi ? normalizeCandidateLink(doi) : null;
}

function extractArxivLike(prompt: string): string | null {
  const arxivUrl = prompt.match(/https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\/[^\s]+/i)?.[0];
  if (arxivUrl) {
    return normalizeCandidateLink(arxivUrl);
  }
  const prefixed = prompt.match(/\barxiv:\s*\d{4}\.\d{4,5}(?:v\d+)?\b/i)?.[0];
  if (prefixed) {
    return normalizeCandidateLink(prefixed);
  }
  const bare = prompt.match(/\b\d{4}\.\d{4,5}(?:v\d+)?\b/)?.[0];
  if (bare) {
    return `arXiv:${bare}`;
  }
  return null;
}

export function extractPaperLinkFromPrompt(prompt: string): string | null {
  return extractUrlLink(prompt) ?? extractArxivLike(prompt) ?? extractDoiLike(prompt);
}

export function inferPaperPromptAction(prompt: string): AgentPaperPromptAction {
  const normalized = prompt.toLowerCase();
  const hasPaperLink = Boolean(extractPaperLinkFromPrompt(prompt));
  if (!hasPaperLink) {
    return "none";
  }
  if (/\btranslate|translation|翻译|译文|双语\b/i.test(prompt)) {
    return "translate";
  }
  if (/\banaly[sz]e|summari[sz]e|review|synthesize|分析|总结|归纳|提炼\b/i.test(prompt)) {
    return "analyze";
  }
  const hasPaperHint = /paper|论文|文献|pdf|article|study|arxiv|doi/i.test(normalized);
  return hasPaperHint ? "import_only" : "none";
}

function scorePathMatch(path: string, link: string): number {
  const lowerPath = path.toLowerCase();
  const lowerLink = link.toLowerCase();
  let score = 0;
  if (lowerPath.endsWith(".pdf")) {
    score += 3;
  }
  if (lowerPath.endsWith(".bib")) {
    score += 2;
  }
  const parts = lowerLink
    .replace(/https?:\/\//g, "")
    .split(/[^a-z0-9]+/g)
    .filter((item) => item.length >= 3)
    .slice(0, 12);
  for (const token of parts) {
    if (lowerPath.includes(token)) {
      score += 1;
    }
  }
  return score;
}

function pickBestImportedPath(candidates: string[], link: string): string | null {
  if (candidates.length === 0) {
    return null;
  }
  const scored = candidates
    .map((path) => ({ path, score: scorePathMatch(path, link) }))
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.path.localeCompare(b.path);
    });
  return scored[0]?.path ?? null;
}

export async function importPaperLinkAndResolveContext(
  projectId: string,
  link: string,
): Promise<AgentPaperLinkImportResult> {
  const normalizedLink = normalizeCandidateLink(link);
  if (!normalizedLink) {
    throw new Error("agent.paper.invalidLink");
  }

  const beforeTree = await getLibraryTree(projectId);
  const beforeSet = new Set(flattenLibraryPaperRefs(beforeTree));

  await importLibraryLink(projectId, normalizedLink);

  const afterTree = await getLibraryTree(projectId);
  const afterRefs = flattenLibraryPaperRefs(afterTree);
  const createdRefs = afterRefs.filter((path) => !beforeSet.has(path));
  const sourcePath = pickBestImportedPath(createdRefs.length > 0 ? createdRefs : afterRefs, normalizedLink);
  if (!sourcePath) {
    throw new Error("agent.paper.importResolveFailed");
  }

  try {
    const preview = await libraryResolvePdfPreview(projectId, sourcePath);
    return {
      sourcePath,
      cachedPdfPath: preview.relativePath ?? null,
      sourceUrl: preview.sourceUrl ?? null,
      cached: Boolean(preview.cached),
    };
  } catch {
    return {
      sourcePath,
      cachedPdfPath: null,
      sourceUrl: null,
      cached: false,
    };
  }
}

export function promptNeedsPaperContext(prompt: string): boolean {
  const request = prompt.toLowerCase();
  const hasPaperHint =
    /论文|文献|paper|pdf|article|study|arxiv|doi/i.test(request);
  const hasActionHint =
    /分析|总结|提炼|归纳|review|analy[sz]e|summari[sz]e|synthesize|写入|write|翻译|translate/i.test(request);
  return hasPaperHint && hasActionHint;
}

export async function resolveAgentPaperSourcePath(
  projectId: string,
  prompt: string,
): Promise<AgentPaperResolution> {
  const explicitRef = extractExplicitPaperRef(prompt);
  if (!explicitRef) {
    return { status: "missing_explicit" };
  }
  try {
    const resolved = await libraryCitationResolve({
      projectId,
      relativePath: explicitRef,
      query: explicitRef,
      includeRemote: false,
    });
    if (resolved.matchedPath) {
      return { status: "ok", sourcePath: resolved.matchedPath };
    }
  } catch {
    // Fall back to tree matching for older projects or partial library state.
  }
  const tree = await getLibraryTree(projectId);
  const pdfPaths = flattenLibraryPaths(tree).filter((item) => /\.(pdf|bib)$/i.test(item));
  const byExact = pdfPaths.find(
    (item) => item.toLowerCase() === explicitRef.toLowerCase(),
  );
  if (byExact) {
    return { status: "ok", sourcePath: byExact };
  }

  const isBasenameRef = !explicitRef.includes("/");
  if (!isBasenameRef) {
    return { status: "not_found", ref: explicitRef };
  }
  const byBasename = pdfPaths.filter((item) => {
    const base = item.split("/").pop() ?? item;
    return base.toLowerCase() === explicitRef.toLowerCase();
  });
  if (byBasename.length === 1) {
    return { status: "ok", sourcePath: byBasename[0] };
  }
  if (byBasename.length > 1) {
    return { status: "ambiguous", ref: explicitRef, matches: byBasename.slice(0, 8) };
  }
  return { status: "not_found", ref: explicitRef };
}

export async function buildAgentPaperContextBlock(
  projectId: string,
  sourcePath: string,
): Promise<string> {
  const context = await buildPaperAnalysisContext(projectId, sourcePath);
  if (context.chunks.length === 0) {
    return [
      `Paper source: ${context.sourcePath}`,
      `Title: ${context.title}`,
      "Metadata:",
      context.metadataBlock,
      "Content: (No extractable text chunks were parsed.)",
    ].join("\n\n");
  }
  const chunks = context.chunks.slice(0, 6).map((chunk) =>
    [
      `[Chunk ${chunk.chunkIndex + 1}] pages ${chunk.pageStart}-${chunk.pageEnd}`,
      chunk.text.slice(0, 1_600),
    ].join("\n"),
  );
  return [
    `Paper source: ${context.sourcePath}`,
    `Title: ${context.title}`,
    "Metadata:",
    context.metadataBlock,
    "Paper chunks:",
    chunks.join("\n\n"),
  ].join("\n\n");
}

export async function resolveAgentPaperContextForPrompt(params: {
  projectId: string;
  prompt: string;
  t: (key: any) => string;
}): Promise<{ paperContextRef: string | null }> {
  const { projectId, prompt, t } = params;
  if (!promptNeedsPaperContext(prompt)) {
    return { paperContextRef: null };
  }

  let sourcePath: string | null = null;
  const resolvedPaper = await resolveAgentPaperSourcePath(projectId, prompt);
  if (resolvedPaper.status === "ok") {
    sourcePath = resolvedPaper.sourcePath;
  } else if (resolvedPaper.status === "missing_explicit") {
    const paperLink = extractPaperLinkFromPrompt(prompt);
    if (!paperLink) {
      throw new Error(t("agent.paper.requireExplicitPath"));
    }
    const imported = await importPaperLinkAndResolveContext(projectId, paperLink);
    sourcePath = imported.sourcePath;
  } else if (resolvedPaper.status === "not_found") {
    throw new Error(t("agent.paper.notFound").replace("{ref}", resolvedPaper.ref));
  } else {
    throw new Error(
      t("agent.paper.ambiguous")
        .replace("{ref}", resolvedPaper.ref)
        .replace("{matches}", resolvedPaper.matches.join(", ")),
    );
  }

  return {
    paperContextRef: sourcePath,
  };
}


