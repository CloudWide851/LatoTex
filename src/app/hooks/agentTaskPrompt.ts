import { buildToolSearchQueryBlock } from "./agentToolSearch";

const AGENT_TASK_FILE_CONTEXT_MAX_CHARS = 24_000;

function isTranslationRequest(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const hasHan = /[\u4e00-\u9fff]/.test(prompt);
  return (
    normalized.includes("translate")
    || normalized.includes("translation")
    || normalized.includes("bilingual")
    || normalized.includes("localization")
    || normalized.includes("术语")
    || normalized.includes("翻译")
    || (hasHan && (normalized.includes("中英") || normalized.includes("英文") || normalized.includes("中文")))
  );
}

function extractTermHints(fileContent: string, maxItems = 18): string[] {
  const out = new Set<string>();
  const latexCommandMatches = fileContent.match(/\\[a-zA-Z]{3,}/g) ?? [];
  for (const item of latexCommandMatches) {
    if (out.size >= maxItems) {
      break;
    }
    out.add(item);
  }

  const acronymMatches = fileContent.match(/\b[A-Z][A-Z0-9_-]{2,}\b/g) ?? [];
  for (const item of acronymMatches) {
    if (out.size >= maxItems) {
      break;
    }
    out.add(item);
  }

  const enWordMatches = fileContent.match(/\b[a-zA-Z][a-zA-Z_-]{4,}\b/g) ?? [];
  for (const item of enWordMatches) {
    if (out.size >= maxItems) {
      break;
    }
    out.add(item);
  }

  const hanPhraseMatches = fileContent.match(/[\u4e00-\u9fff]{2,12}/g) ?? [];
  for (const item of hanPhraseMatches) {
    if (out.size >= maxItems) {
      break;
    }
    out.add(item);
  }

  return Array.from(out);
}

function buildTranslationStrategyBlock(userPrompt: string, fileContent: string): string {
  if (!isTranslationRequest(userPrompt)) {
    return "";
  }
  const termHints = extractTermHints(fileContent, 18);
  return [
    "[translation.strategy.v2]",
    "- Preserve formula tokens, citations, labels, and code-like identifiers.",
    "- Reuse glossary/memory terms whenever available for consistent translation.",
    "- Keep context coherence across sections (do not translate identical terms inconsistently).",
    "- If uncertain, keep source token and annotate uncertainty in output comments.",
    "- For ambiguous domain terms, call tool_search first and then update translation based on evidence.",
    ...(termHints.length > 0
      ? [
          "- Candidate glossary hints:",
          ...termHints.map((item) => `  - ${item}`),
        ]
      : []),
  ].join("\n");
}

function detectCitationCommand(userPrompt: string, fileContent: string): string {
  const lowerPrompt = userPrompt.toLowerCase();
  if (lowerPrompt.includes("textcite") || fileContent.includes("\\textcite{")) return "\\textcite";
  if (lowerPrompt.includes("parencite") || fileContent.includes("\\parencite{")) return "\\parencite";
  if (lowerPrompt.includes("autocite") || fileContent.includes("\\autocite{")) return "\\autocite";
  if (lowerPrompt.includes("citep") || fileContent.includes("\\citep{")) return "\\citep";
  if (lowerPrompt.includes("citet") || fileContent.includes("\\citet{")) return "\\citet";
  if (fileContent.includes("\\usepackage{biblatex}") || fileContent.includes("\\addbibresource")) return "\\autocite";
  if (fileContent.includes("\\usepackage{natbib}")) return "\\citep";
  return "\\cite";
}

function isCitationInsertionRequest(userPrompt: string): boolean {
  const lower = userPrompt.toLowerCase();
  return lower.includes("citation")
    || lower.includes("insert cite")
    || lower.includes("cite ")
    || userPrompt.includes("引用")
    || userPrompt.includes("引文")
    || userPrompt.includes("插入参考文献");
}

function deriveTaskSearchQueries(userPrompt: string, paperContext?: string, fileContent?: string): string[] {
  const candidates = userPrompt
    .split(/[\r\n,，;；。!?！？]+/g)
    .map((item) => item.trim())
    .filter((item) => item.length >= 3)
    .slice(0, 6);

  if (paperContext) {
    const titleLine = paperContext
      .split(/\r?\n/g)
      .find((line) => line.toLowerCase().startsWith("title:"));
    if (titleLine) {
      const title = titleLine.slice("title:".length).trim();
      if (title.length >= 3) {
        candidates.unshift(title);
      }
    }
  }

  if (fileContent && isTranslationRequest(userPrompt)) {
    for (const term of extractTermHints(fileContent, 14)) {
      if (term.length >= 3) {
        candidates.push(`term meaning ${term}`);
        candidates.push(`translate technical term ${term}`);
      }
    }
  }

  return Array.from(new Set(candidates)).slice(0, 12);
}

export function buildTaskExecutionPrompt(params: {
  userPrompt: string;
  targetPath: string;
  fileContent: string;
  paperContext?: string;
}): string {
  const { userPrompt, targetPath, fileContent, paperContext } = params;
  const normalized = fileContent.replace(/\r\n/g, "\n");
  const truncated =
    normalized.length > AGENT_TASK_FILE_CONTEXT_MAX_CHARS
      ? `${normalized.slice(0, AGENT_TASK_FILE_CONTEXT_MAX_CHARS)}\n\n...[TRUNCATED FOR CONTEXT]...`
      : normalized;
  const queryBlock = buildToolSearchQueryBlock(
    deriveTaskSearchQueries(userPrompt, paperContext, normalized),
  );
  const translationStrategy = buildTranslationStrategyBlock(userPrompt, normalized);

  return [
    "You are editing files in an IDE.",
    "Return only IDE-style SEARCH/REPLACE edit blocks in ```edit fences.",
    "Do not output full-file rewrites unless unavoidable.",
    "For long files, generate minimal partial edits by exact matching.",
    "If factual details are uncertain, rely on tool_search evidence and do not invent claims or references.",
    "When evidence is insufficient, keep the original text for that uncertain part.",
    "Each edit block must be:",
    "path: <relative path>",
    "<<<<<<< SEARCH",
    "<exact text to find>",
    "=======",
    "<replacement text>",
    ">>>>>>> REPLACE",
    "",
    `Target path: ${targetPath}`,
    "",
    "User request:",
    userPrompt,
    "",
    ...(translationStrategy
      ? [translationStrategy, ""]
      : []),
    ...(isCitationInsertionRequest(userPrompt)
      ? [
          "[citation.insertion.v1]",
          `- Preferred citation command for this target: ${detectCitationCommand(userPrompt, normalized)}{key}.`,
          "- Use BibTeX keys from attached .bib context when available.",
          "- Insert citations into the target .tex content, not into the .bib file, unless the user explicitly asks to edit bibliography entries.",
          "",
        ]
      : []),
    queryBlock,
    "",
    ...(paperContext
      ? [
          "Paper context:",
          paperContext,
          "",
        ]
      : []),
    "",
    "Current file content:",
    truncated,
  ].join("\n");
}

export function buildAnalysisPrompt(sourcePrompt: string, modelOutput: string, targetPath: string): string {
  return [
    "Analyze the generated LaTeX modifications and produce a data report.",
    "Focus on: structure changes, section counts, math density, citation/reference usage, and potential consistency risks.",
    `Target file: ${targetPath}`,
    "",
    "Original request:",
    sourcePrompt,
    "",
    "Model output:",
    modelOutput.slice(0, 8000),
  ].join("\n");
}
