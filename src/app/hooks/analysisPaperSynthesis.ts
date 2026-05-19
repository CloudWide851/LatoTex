import type { PaperAnalysisContext, PaperChunk } from "./analysisDataSources";

const PAPER_FINAL_SOURCE_LIMIT = 16_000;
const PAPER_CONDENSED_OUTPUT_LIMIT = 9_000;
const PAPER_RAW_SUMMARY_LIMIT = 24_000;

function trimBlock(text: string, limit: number): string {
  const normalized = String(text ?? "").trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, limit - 15)).trimEnd()}\n\n[truncated]`;
}

export function buildPaperSourceBlock(
  paperContext: PaperAnalysisContext,
  chunkSummaries: string[],
): string {
  return [
    `Paper source: ${paperContext.sourcePath}`,
    `Title: ${paperContext.title}`,
    `Detected language: ${paperContext.detectedLanguage ?? "unknown"}`,
    `Extraction: ${paperContext.extractionEngine ?? "unknown"} / ${paperContext.extractionMode ?? "unknown"}`,
    `Pages: ${paperContext.pageCount} (ocr=${paperContext.ocrPageCount})`,
    "Metadata:",
    paperContext.metadataBlock,
    "Chunk summaries:",
    trimBlock(chunkSummaries.join("\n\n"), PAPER_RAW_SUMMARY_LIMIT),
  ].join("\n\n");
}

export function shouldCondensePaperSource(rawSourceBlock: string, chunkCount: number): boolean {
  return rawSourceBlock.length > PAPER_FINAL_SOURCE_LIMIT || chunkCount > 2;
}

export function buildPaperCondensePrompt(input: {
  outputLanguageLabel: string;
  normalizedPrompt: string;
  paperContext: PaperAnalysisContext;
  chunkSummaries: string[];
}): string {
  return [
    `Output language must be ${input.outputLanguageLabel}.`,
    "You are consolidating a paper analysis before final report generation.",
    "Return concise markdown only.",
    "Keep: paper goal, methods, evidence, limitations, contribution, practical takeaways, and any controversial/uncertain points.",
    "Preserve formulas, metric names, citations, section names, and key numbers.",
    "Compress aggressively but do not lose important technical evidence.",
    "User request:",
    input.normalizedPrompt,
    "Paper metadata:",
    input.paperContext.metadataBlock,
    "Chunk summaries:",
    trimBlock(input.chunkSummaries.join("\n\n"), PAPER_RAW_SUMMARY_LIMIT),
  ].join("\n\n");
}

export function buildCondensedPaperSourceBlock(
  paperContext: PaperAnalysisContext,
  condensedSummary: string,
): string {
  return [
    `Paper source: ${paperContext.sourcePath}`,
    `Title: ${paperContext.title}`,
    `Detected language: ${paperContext.detectedLanguage ?? "unknown"}`,
    `Extraction: ${paperContext.extractionEngine ?? "unknown"} / ${paperContext.extractionMode ?? "unknown"}`,
    `Pages: ${paperContext.pageCount} (ocr=${paperContext.ocrPageCount})`,
    "Metadata:",
    paperContext.metadataBlock,
    "Condensed synthesis:",
    trimBlock(condensedSummary, PAPER_CONDENSED_OUTPUT_LIMIT),
  ].join("\n\n");
}

export function buildFallbackPaperSourceBlock(rawSourceBlock: string): string {
  return trimBlock(rawSourceBlock, PAPER_FINAL_SOURCE_LIMIT);
}

export function buildAnalysisSynthesisPrompt(
  outputLanguageLabel: string,
  normalizedPrompt: string,
  sourceBlock: string,
): string {
  return [
    `You are a senior data analyst operating in a Codex-style plan, inspect, execute, review loop. Output language must be ${outputLanguageLabel}.`,
    "Return strict JSON only with keys:",
    "title (string), summary (string), steps (string[]), insights (string[]), sections ({title,content}[]), chart ({label,value}[])",
    "The report must be complete, practical, visually-oriented, and reproducible.",
    "Before writing conclusions, reason through: user goal, available sources, data quality, missing fields, assumptions, method choice, boundary conditions, and regression/security/privacy risks.",
    "Use steps for the actual operation chain. Include data cleaning/profiling, analysis method, validation/review, and artifact generation where relevant.",
    "Use insights for high-signal findings only. Each insight should include evidence, confidence, and a concrete action when possible.",
    "Use sections for deeper explanation: data quality, methodology, findings, limitations, recommended next actions.",
    "Use chart values only when they are supported by source data or profile output; never invent metrics.",
    "If user asks another language explicitly, honor user request.",
    "User request:",
    normalizedPrompt,
    "Source material:",
    sourceBlock,
  ].join("\n\n");
}

export function buildAnalysisJsonRepairPrompt(
  outputLanguageLabel: string,
  rawOutput: string,
): string {
  return [
    `Output language must be ${outputLanguageLabel}.`,
    "You are a strict JSON formatter.",
    "Transform the source text into a strict JSON object only (no markdown code block).",
    "Allowed keys only:",
    "title (string), summary (string), steps (string[]), insights (string[]), sections ({title,content}[]), chart ({label,value}[])",
    "If unknown, use empty strings/arrays. Do not omit keys.",
    "Source output to normalize:",
    rawOutput.slice(0, 14_000),
  ].join("\n\n");
}

export async function summarizePaperChunks(input: {
  chunks: PaperChunk[];
  outputLanguageLabel: string;
  runChunkPrompt: (promptText: string) => Promise<string>;
  onChunkFailure: (chunk: PaperChunk, reason: string) => Promise<void>;
}): Promise<{ chunkSummaries: string[]; chunkFailures: number }> {
  const chunkSummaries: string[] = [];
  let chunkFailures = 0;

  for (const chunk of input.chunks) {
    const chunkPrompt = [
      `Summarize the following paper segment in ${input.outputLanguageLabel}.`,
      "Return concise markdown bullet points of methods, findings, and limitations.",
      `Chunk pages: ${chunk.pageStart}-${chunk.pageEnd}`,
      chunk.text,
    ].join("\n\n");
    try {
      const output = await input.runChunkPrompt(chunkPrompt);
      chunkSummaries.push(`[Chunk ${chunk.chunkIndex + 1} | pages ${chunk.pageStart}-${chunk.pageEnd}]\n${output}`);
    } catch (error) {
      chunkFailures += 1;
      const reason = error instanceof Error ? error.message : String(error);
      await input.onChunkFailure(chunk, reason);
    }
  }

  return { chunkSummaries, chunkFailures };
}
