import { getLibraryTree } from "../../shared/api/desktop";
import type { ResourceNode } from "../../shared/types/app";
import { buildPaperAnalysisContext } from "./analysisDataSources";

export type AgentPaperResolution =
  | { status: "ok"; sourcePath: string }
  | { status: "missing_explicit" }
  | { status: "not_found"; ref: string }
  | { status: "ambiguous"; ref: string; matches: string[] };

function normalizePaperRef(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^\/+/, "")
    .replace(/^\.\/+/, "")
    .replace(/^\.latotex\/papers\/+/i, "");
}

function flattenLibraryPdfPaths(nodes: ResourceNode[], acc: string[] = []): string[] {
  for (const node of nodes) {
    if (node.kind === "file" && /\.pdf$/i.test(node.relativePath)) {
      acc.push(node.relativePath.replace(/\\/g, "/"));
      continue;
    }
    if (node.kind === "directory" && Array.isArray(node.children)) {
      flattenLibraryPdfPaths(node.children, acc);
    }
  }
  return acc;
}

function extractExplicitPaperRef(prompt: string): string | null {
  const quotedMatch = prompt.match(/["'`]([^"'`]+?\.pdf)["'`]/i);
  if (quotedMatch?.[1]) {
    return normalizePaperRef(quotedMatch[1]);
  }
  const plainMatch = prompt.match(/[\p{L}\p{N}_\-./\\]+\.pdf\b/iu);
  if (plainMatch?.[0]) {
    return normalizePaperRef(plainMatch[0]);
  }
  return null;
}

export function promptNeedsPaperContext(prompt: string): boolean {
  const request = prompt.toLowerCase();
  const hasPaperHint =
    /论文|文献|paper|pdf|article|study|arxiv|doi/i.test(request);
  const hasActionHint =
    /分析|总结|提炼|归纳|review|analy[sz]e|summari[sz]e|synthesize|写入|write/i.test(request);
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
  const tree = await getLibraryTree(projectId);
  const pdfPaths = flattenLibraryPdfPaths(tree);
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
}): Promise<{ paperContextBlock: string; paperContextRef: string | null }> {
  const { projectId, prompt, t } = params;
  if (!promptNeedsPaperContext(prompt)) {
    return { paperContextBlock: "", paperContextRef: null };
  }
  const resolvedPaper = await resolveAgentPaperSourcePath(projectId, prompt);
  if (resolvedPaper.status === "missing_explicit") {
    throw new Error(t("agent.paper.requireExplicitPath"));
  }
  if (resolvedPaper.status === "not_found") {
    throw new Error(t("agent.paper.notFound").replace("{ref}", resolvedPaper.ref));
  }
  if (resolvedPaper.status === "ambiguous") {
    throw new Error(
      t("agent.paper.ambiguous")
        .replace("{ref}", resolvedPaper.ref)
        .replace("{matches}", resolvedPaper.matches.join(", ")),
    );
  }
  return {
    paperContextBlock: await buildAgentPaperContextBlock(projectId, resolvedPaper.sourcePath),
    paperContextRef: resolvedPaper.sourcePath,
  };
}
