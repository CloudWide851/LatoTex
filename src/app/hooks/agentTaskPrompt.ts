import { buildToolSearchQueryBlock } from "./agentToolSearch";

const AGENT_TASK_FILE_CONTEXT_MAX_CHARS = 24_000;

function deriveTaskSearchQueries(userPrompt: string, paperContext?: string): string[] {
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
  return Array.from(new Set(candidates)).slice(0, 8);
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
  const queryBlock = buildToolSearchQueryBlock(deriveTaskSearchQueries(userPrompt, paperContext));
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
