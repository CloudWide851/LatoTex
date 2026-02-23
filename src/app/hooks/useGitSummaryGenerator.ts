import { gitDiffFile, runAgent } from "../../shared/api/desktop";

export async function generateGitSummary(
  activeProjectId: string | null,
  includedPaths: string[],
): Promise<string> {
  if (!activeProjectId) {
    throw new Error("No active project");
  }
  const files = Array.from(
    new Set(
      includedPaths
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  ).slice(0, 24);
  if (files.length === 0) {
    return "";
  }

  const patches = await Promise.all(
    files.map(async (path) => {
      try {
        const diff = await gitDiffFile(activeProjectId, path, true, 2);
        const lines = diff.hunks
          .flatMap((hunk) => hunk.lines)
          .map((line) => line.text)
          .join("\n");
        return lines.trim().length > 0 ? `### ${path}\n${lines}` : "";
      } catch {
        return "";
      }
    }),
  );

  const joinedPatch = patches.filter((item) => item.length > 0).join("\n\n").slice(0, 48_000);
  const prompt = [
    "Summarize the staged Git changes and return a commit message proposal.",
    "Output format:",
    "TITLE: <single line, <=72 chars>",
    "BODY:",
    "- <bullet 1>",
    "- <bullet 2>",
    "Use concise, technical wording.",
    "",
    `Files: ${files.join(", ")}`,
    "",
    "Patch:",
    joinedPatch || "(empty patch text)",
  ].join("\n");

  const result = await runAgent({
    projectId: activeProjectId,
    role: "git_summary",
    prompt,
    contextRefs: files,
  });

  const output = result.output?.trim() ?? "";
  if (!output) {
    return "";
  }
  const titleMatch = output.match(/^TITLE:\s*(.+)$/im);
  if (titleMatch?.[1]) {
    return titleMatch[1].trim();
  }
  return output.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? "";
}
