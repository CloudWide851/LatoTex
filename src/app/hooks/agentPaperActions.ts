import { translateLibraryDocument } from "../../shared/api/desktop";
import {
  buildAgentPaperContextBlock,
  importPaperLinkAndResolveContext,
  inferPaperPromptAction,
  extractPaperLinkFromPrompt,
} from "./agentPaperContext";
import { runAgentThroughEvents } from "./agentRunEvents";

export type PaperLinkFlowAction = "import_only" | "analyze" | "translate";

export function resolvePaperFlowAction(input: string): PaperLinkFlowAction {
  const inferred = inferPaperPromptAction(input);
  if (inferred === "translate") {
    return "translate";
  }
  if (inferred === "analyze") {
    return "analyze";
  }
  return "import_only";
}

export function resolvePaperCommandLink(args: string): string {
  const fromPrompt = extractPaperLinkFromPrompt(args);
  if (fromPrompt) {
    return fromPrompt;
  }
  return args.trim().split(/\s+/)[0] ?? "";
}

export async function executePaperLinkFlow(params: {
  activeProjectId: string;
  link: string;
  action: PaperLinkFlowAction;
  instruction?: string;
  t: (key: any) => string;
  withMemoryContext: (basePrompt: string) => string;
  setAgentRunId: (value: string | null) => void;
  modelOverride?: string;
  pushAgentMessage: (text: string, format?: "plain" | "markdown") => void;
  normalizeOutput: (raw: string) => string;
}): Promise<void> {
  const {
    activeProjectId,
    link,
    action,
    instruction,
    t,
    withMemoryContext,
    setAgentRunId,
    modelOverride,
    pushAgentMessage,
    normalizeOutput,
  } = params;

  const imported = await importPaperLinkAndResolveContext(activeProjectId, link);
  pushAgentMessage(
    t("agent.command.paper.imported")
      .replace("{path}", imported.sourcePath)
      .replace("{link}", link),
  );
  if (imported.cachedPdfPath) {
    pushAgentMessage(
      t("agent.command.paper.cached")
        .replace("{path}", imported.cachedPdfPath)
        .replace("{source}", imported.sourceUrl ?? "-"),
    );
  } else {
    pushAgentMessage(t("agent.command.paper.cachedPending"));
  }

  if (action === "import_only") {
    return;
  }

  if (action === "translate") {
    const translated = await translateLibraryDocument({
      projectId: activeProjectId,
      relativePath: imported.sourcePath,
      modelOverride,
    });
    const paths = (translated.artifactPaths ?? []).join(", ");
    pushAgentMessage(
      t("agent.command.paper.translateDone")
        .replace("{path}", translated.relativePath)
        .replace("{engine}", translated.engine || "-"),
    );
    if (paths) {
      pushAgentMessage(t("agent.command.paper.artifacts").replace("{paths}", paths));
    }
    return;
  }

  const paperContext = await buildAgentPaperContextBlock(activeProjectId, imported.sourcePath);
  const analysisPrompt = [
    "You are a research-paper analyst.",
    "Read the paper context and return a concise markdown report with sections:",
    "1) Core Problem 2) Method 3) Evidence 4) Limitations 5) Actionable next steps.",
    "If evidence is missing, state uncertainty explicitly.",
    instruction?.trim() ? `User focus: ${instruction.trim()}` : "",
    "",
    paperContext,
  ]
    .filter(Boolean)
    .join("\n");
  const response = await runAgentThroughEvents({
    activeProjectId,
    workflowId: "latex.paper_analyze",
    callsite: "latex.overlay",
    prompt: withMemoryContext(analysisPrompt),
    contextRefs: [`paper:${imported.sourcePath}`],
    setAgentRunId,
    modelOverride,
  });
  pushAgentMessage(normalizeOutput(response.output), "markdown");
}


