import {
  getEvents,
  readFile,
  referenceCheck,
  runAgentStart,
  runtimeLogWrite,
  writeFile,
} from "../../shared/api/desktop";
import type { Dispatch, SetStateAction } from "react";
import type { AgentChatMessage, AgentFileProposal } from "./agentTypes";
import { extractReferenceQueries, parseAgentPrompt } from "./agentCommands";
import {
  computeDiffStats,
  isLatexPath,
  normalizePath,
  pickTargetPath,
  resolveCandidateFromOutput,
} from "./agentPatchEdits";

const MAX_AGENT_MESSAGES = 200;
const AGENT_WAIT_TIMEOUT_MS = 240_000;
const AGENT_WAIT_INTERVAL_MS = 280;
const AGENT_TASK_FILE_CONTEXT_MAX_CHARS = 24_000;

type AgentMessageSetter = Dispatch<SetStateAction<AgentChatMessage[]>>;

type AgentPhase = "idle" | "running" | "done" | "error";
type AgentStatusKey = "agent.statusIdle" | "agent.statusRunning" | "agent.statusDone" | "agent.statusError";

type AgentPermissions = {
  version: number;
  allowedNonLatexTargets: string[];
};
function nextAgentId(role: "user" | "agent", suffix = ""): string {
  return `${Date.now()}-${role}${suffix}`;
}

function pushMessage(setter: AgentMessageSetter, message: AgentChatMessage) {
  setter((prev) => [...prev, message].slice(-MAX_AGENT_MESSAGES));
}

function tryDecodeSerializedOutput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return raw;
  }

  try {
    if (
      (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === "string" && parsed.trim().length > 0) {
        return parsed;
      }
    }
  } catch {
    // Ignore parse errors and keep raw text.
  }

  try {
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      const parsed = JSON.parse(trimmed) as unknown;
      if (typeof parsed === "string" && parsed.trim().length > 0) {
        return parsed;
      }
      if (Array.isArray(parsed)) {
        const firstText = parsed.find(
          (item) => typeof item === "string" && item.trim().length > 0,
        );
        if (typeof firstText === "string") {
          return firstText;
        }
      } else if (parsed && typeof parsed === "object") {
        const payload = parsed as { output?: unknown; content?: unknown; message?: unknown };
        const fromFields = [payload.output, payload.content, payload.message].find(
          (item) => typeof item === "string" && item.trim().length > 0,
        );
        if (typeof fromFields === "string") {
          return fromFields;
        }
      }
    }
  } catch {
    // Ignore parse errors and keep raw text.
  }

  return raw;
}

function cleanAgentOutput(raw: string): string {
  return tryDecodeSerializedOutput(raw)
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildAnalysisPrompt(sourcePrompt: string, modelOutput: string, targetPath: string): string {
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

function buildTaskExecutionPrompt(params: {
  userPrompt: string;
  targetPath: string;
  fileContent: string;
}): string {
  const { userPrompt, targetPath, fileContent } = params;
  const normalized = fileContent.replace(/\r\n/g, "\n");
  const truncated =
    normalized.length > AGENT_TASK_FILE_CONTEXT_MAX_CHARS
      ? `${normalized.slice(0, AGENT_TASK_FILE_CONTEXT_MAX_CHARS)}\n\n...[TRUNCATED FOR CONTEXT]...`
      : normalized;
  return [
    "You are editing files in an IDE.",
    "Return only IDE-style SEARCH/REPLACE edit blocks in ```edit fences.",
    "Do not output full-file rewrites unless unavoidable.",
    "For long files, generate minimal partial edits by exact matching.",
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
    "Current file content:",
    truncated,
  ].join("\n");
}

async function loadOriginalContent(params: {
  activeProjectId: string;
  targetPath: string;
  selectedFile: string | null;
  editorContent: string;
}): Promise<string> {
  const { activeProjectId, targetPath, selectedFile, editorContent } = params;
  if (selectedFile === targetPath) {
    return editorContent;
  }
  try {
    const loaded = await readFile(activeProjectId, targetPath);
    return loaded.content ?? "";
  } catch {
    return "";
  }
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
async function waitForAgentRunOutput(runId: string): Promise<string> {
  let cursor = 0;
  const startedAt = Date.now();
  let fallbackOutput = "";

  while (Date.now() - startedAt < AGENT_WAIT_TIMEOUT_MS) {
    const batch = await getEvents(cursor, 200, runId);
    cursor = batch.nextCursor;
    for (const event of batch.events) {
      const payload = event.payload ?? {};
      const kind = event.kind;
      if (kind === "responses.output_text.delta") {
        const chunk = typeof payload.content === "string" ? payload.content : "";
        fallbackOutput += chunk;
      }
      if (kind === "agent.run.completed") {
        const output = typeof payload.output === "string" ? payload.output : fallbackOutput;
        return output;
      }
      if (kind === "agent.run.failed") {
        const message =
          typeof payload.content === "string" && payload.content.trim().length > 0
            ? payload.content
            : "agent.run.failed";
        throw new Error(message);
      }
    }
    await delay(AGENT_WAIT_INTERVAL_MS);
  }

  throw new Error("agent.run.timeout");
}

async function runAgentThroughEvents(params: {
  activeProjectId: string;
  role: string;
  prompt: string;
  contextRefs: string[];
  setAgentRunId: (value: string | null) => void;
}): Promise<{ runId: string; output: string }> {
  const accepted = await runAgentStart({
    projectId: params.activeProjectId,
    role: params.role,
    prompt: params.prompt,
    contextRefs: params.contextRefs,
    bypassCache: true,
  });
  params.setAgentRunId(accepted.runId);
  const output = await waitForAgentRunOutput(accepted.runId);
  return { runId: accepted.runId, output };
}

async function loadAgentPermissions(activeProjectId: string): Promise<AgentPermissions> {
  try {
    const result = await readFile(activeProjectId, ".latotex/agent-permissions.json");
    const parsed = JSON.parse(result.content) as Partial<AgentPermissions>;
    return {
      version: 1,
      allowedNonLatexTargets: Array.isArray(parsed.allowedNonLatexTargets)
        ? parsed.allowedNonLatexTargets.map((item) => normalizePath(String(item)))
        : [],
    };
  } catch {
    return { version: 1, allowedNonLatexTargets: [] };
  }
}

async function saveAgentPermissions(
  activeProjectId: string,
  permissions: AgentPermissions,
): Promise<void> {
  await writeFile(
    activeProjectId,
    ".latotex/agent-permissions.json",
    `${JSON.stringify(permissions, null, 2)}\n`,
  );
}

async function shouldAllowTargetPath(params: {
  activeProjectId: string;
  targetPath: string;
  explicitPath: boolean;
  t: (key: any) => string;
  setToast: (value: { type: "info" | "error"; message: string }) => void;
}): Promise<boolean> {
  const { activeProjectId, targetPath, explicitPath, t, setToast } = params;
  if (isLatexPath(targetPath)) {
    return true;
  }
  if (!explicitPath) {
    setToast({ type: "info", message: t("agent.nonLatexSkipped") });
    return false;
  }
  const permissions = await loadAgentPermissions(activeProjectId);
  if (permissions.allowedNonLatexTargets.includes(targetPath)) {
    return true;
  }
  const promptText = t("agent.nonLatexPrompt")
    .replace("{path}", targetPath)
    .trim();
  const response = (window.prompt(promptText, "no") ?? "no")
    .trim()
    .toLowerCase();
  if (response === "yes") {
    return true;
  }
  if (response === "remember") {
    permissions.allowedNonLatexTargets = Array.from(
      new Set([...permissions.allowedNonLatexTargets, targetPath]),
    );
    await saveAgentPermissions(activeProjectId, permissions);
    setToast({ type: "info", message: t("agent.nonLatexRemembered") });
    return true;
  }
  if (response !== "no") {
    setToast({ type: "error", message: t("agent.nonLatexInvalidChoice") });
  }
  return false;
}

export async function runAgentWorkflow(params: {
  activeProjectId: string;
  agentPrompt: string;
  editorContent: string;
  selectedFile: string | null;
  t: (key: any) => string;
  setAgentMessages: AgentMessageSetter;
  setAgentProposal: (value: AgentFileProposal | null) => void;
  setAgentRunId: (value: string | null) => void;
  setAgentPrompt: (value: string) => void;
  setAgentCollapsed: (value: boolean) => void;
  setAgentPhase: (value: AgentPhase) => void;
  setAgentStatusKey: (value: AgentStatusKey) => void;
  setToast: (value: { type: "info" | "error"; message: string }) => void;
  setEditorContent: (value: string) => void;
  setSelectedFile: (value: string | null) => void;
  runCompilePass: (params: {
    projectId: string;
    mainPath: string;
    mainContent: string;
    options: { updatePreview: boolean; emitToast: boolean };
  }) => Promise<{ status: string; diagnostics: string[] }>;
}) {
  const {
    activeProjectId,
    agentPrompt,
    editorContent,
    selectedFile,
    t,
    setAgentMessages,
    setAgentProposal,
    setAgentRunId,
    setAgentPrompt,
    setAgentCollapsed,
    setAgentPhase,
    setAgentStatusKey,
    setToast,
    setEditorContent,
    setSelectedFile,
    runCompilePass,
  } = params;

  const prompt = agentPrompt.trim();
  const parsed = parseAgentPrompt(prompt);
  const { targetPath, explicitPath } = pickTargetPath(prompt, selectedFile);

  setAgentProposal(null);
  setAgentRunId(null);
  pushMessage(setAgentMessages, {
    id: nextAgentId("user"),
    role: "user",
    text: prompt,
    format: "plain",
  });
  setAgentPrompt("");
  setAgentCollapsed(false);
  setAgentPhase("running");
  setAgentStatusKey("agent.statusRunning");

  const pushAgentMessage = (text: string, format: "plain" | "markdown" = "plain") => {
    pushMessage(setAgentMessages, {
      id: nextAgentId("agent"),
      role: "agent",
      text,
      format,
    });
  };

  try {
    if (parsed.kind === "command" && parsed.command === "review") {
      if (!selectedFile) {
        throw new Error(t("agent.command.requiresFile"));
      }
      let workingContent = editorContent;
      let compileResult = await runCompilePass({
        projectId: activeProjectId,
        mainPath: selectedFile,
        mainContent: workingContent,
        options: { updatePreview: true, emitToast: false },
      });
      if (compileResult.status === "success") {
        pushAgentMessage(t("agent.command.review.noIssues"));
        setAgentPhase("done");
        setAgentStatusKey("agent.statusDone");
        return;
      }

      const extraInstruction = parsed.args
        ? `\nAdditional instruction: ${parsed.args}`
        : "";
      let fixed = false;
      let fixedContent = "";
      for (let round = 0; round < 3; round += 1) {
        const reviewPrompt = [
          "You are a LaTeX fixer.",
          "Apply minimal changes so the document compiles.",
          "Return IDE-style SEARCH/REPLACE edit blocks inside ```edit fences.",
          "Each edit block must include path, SEARCH, REPLACE.",
          "Only edit the requested target file.",
          "",
          `Compile diagnostics:\n${compileResult.diagnostics.join("\n")}`,
          extraInstruction,
          "",
          "Current LaTeX content:",
          workingContent,
        ].join("\n");
        const response = await runAgentThroughEvents({
          activeProjectId,
          role: "review",
          prompt: reviewPrompt,
          contextRefs: selectedFile ? [`file:${selectedFile}`] : [],
          setAgentRunId,
        });
        const normalized = cleanAgentOutput(response.output);
        const resolved = resolveCandidateFromOutput({
          output: normalized,
          targetPath: selectedFile,
          baseContent: workingContent,
        });
        if (!resolved.candidate) {
          continue;
        }
        const candidate = resolved.candidate;
        workingContent = candidate;
        compileResult = await runCompilePass({
          projectId: activeProjectId,
          mainPath: selectedFile,
          mainContent: candidate,
          options: { updatePreview: true, emitToast: false },
        });
        if (compileResult.status === "success") {
          fixed = true;
          fixedContent = candidate;
          break;
        }
      }
      if (fixed) {
        const originalContent = await loadOriginalContent({
          activeProjectId,
          targetPath,
          selectedFile,
          editorContent,
        });
        const { insertions, deletions, changedLines } = computeDiffStats(
          originalContent,
          fixedContent,
        );
        if (selectedFile !== targetPath) {
          setSelectedFile(targetPath);
        }
        setEditorContent(fixedContent);
        setAgentProposal({
          id: `proposal-${Date.now()}-review`,
          targetPath,
          originalContent,
          candidateContent: fixedContent,
          summary: t("agent.proposalReady"),
          analysisPrompt: buildAnalysisPrompt(prompt, fixedContent, targetPath),
          insertions,
          deletions,
          changedLines,
          previewApplied: true,
        });
        pushAgentMessage(t("agent.proposalPreviewed"));
        setAgentPhase("done");
        setAgentStatusKey("agent.statusDone");
        return;
      }
      pushAgentMessage(t("agent.command.review.failed"));
      setToast({ type: "error", message: t("toast.compileFailed") });
      setAgentPhase("error");
      setAgentStatusKey("agent.statusError");
      return;
    }

    if (parsed.kind === "command" && parsed.command === "check-ref") {
      const queries = extractReferenceQueries(editorContent, parsed.args);
      if (queries.length === 0) {
        pushAgentMessage(t("agent.command.checkRef.noTargets"));
        setAgentPhase("done");
        setAgentStatusKey("agent.statusDone");
        return;
      }
      const references = await referenceCheck(queries, 5);
      const analysisPrompt = [
        "You are a citation verifier.",
        "Assess if each reference appears real and correctly linked to source evidence.",
        "Return concise sections: PASS, WARNING, ACTION.",
        "",
        JSON.stringify(references, null, 2),
      ].join("\n");
      const response = await runAgentThroughEvents({
        activeProjectId,
        role: "web_search",
        prompt: analysisPrompt,
        contextRefs: selectedFile ? [`file:${selectedFile}`] : [],
        setAgentRunId,
      });
      pushAgentMessage(cleanAgentOutput(response.output), "markdown");
      setAgentPhase("done");
      setAgentStatusKey("agent.statusDone");
      return;
    }

    const allowed = await shouldAllowTargetPath({
      activeProjectId,
      targetPath,
      explicitPath,
      t,
      setToast,
    });
    if (!allowed) {
      setAgentPhase("done");
      setAgentStatusKey("agent.statusDone");
      return;
    }

    const originalContent = await loadOriginalContent({
      activeProjectId,
      targetPath,
      selectedFile,
      editorContent,
    });
    const taskPrompt = buildTaskExecutionPrompt({
      userPrompt: prompt,
      targetPath,
      fileContent: originalContent,
    });
    const taskRefs = Array.from(
      new Set([`file:${targetPath}`, ...(selectedFile ? [`file:${selectedFile}`] : [])]),
    );
    const response = await runAgentThroughEvents({
      activeProjectId,
      role: "task",
      prompt: taskPrompt,
      contextRefs: taskRefs,
      setAgentRunId,
    });
    await runtimeLogWrite("INFO", `${t("log.agentRunDone")}, runId=${response.runId}`);
    const normalizedOutput = cleanAgentOutput(response.output);
    pushAgentMessage(normalizedOutput, "markdown");
    const resolved = resolveCandidateFromOutput({
      output: normalizedOutput,
      targetPath,
      baseContent: originalContent,
    });
    if (!resolved.candidate) {
      if (resolved.failedReason !== "none") {
        pushAgentMessage(t("agent.patch.noApplicableEdits"));
      }
    } else if (resolved.candidate.trim() !== originalContent.trim()) {
      const { insertions, deletions, changedLines } = computeDiffStats(
        originalContent,
        resolved.candidate,
      );
      if (selectedFile !== targetPath) {
        setSelectedFile(targetPath);
      }
      setEditorContent(resolved.candidate);
      setAgentProposal({
        id: `proposal-${Date.now()}-task`,
        targetPath,
        originalContent,
        candidateContent: resolved.candidate,
        summary: t("agent.proposalReady"),
        analysisPrompt: buildAnalysisPrompt(prompt, normalizedOutput, targetPath),
        insertions,
        deletions,
        changedLines,
        previewApplied: true,
      });
      pushAgentMessage(t("agent.proposalPreviewed"));
    }

    setAgentPhase("done");
    setAgentStatusKey("agent.statusDone");
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const toastMessage = rawMessage === "agent.run.timeout"
      ? t("agent.run.timeout")
      : rawMessage === "agent.run.failed"
        ? t("agent.run.failed")
        : rawMessage;
    setAgentPhase("error");
    setAgentStatusKey("agent.statusError");
    setToast({ type: "error", message: toastMessage });
  }
}
