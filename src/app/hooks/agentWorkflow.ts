import {
  readFile,
  runtimeLogWrite,
  writeFile,
} from "../../shared/api/desktop";
import type { Dispatch, SetStateAction } from "react";
import type { AgentChatMessage, AgentFileProposal } from "./agentTypes";
import { extractReferenceQueries, parseAgentPrompt, resolveAgentCommitIntent } from "./agentCommands";
import { buildToolSearchQueryBlock } from "./agentToolSearch";
import {
  computeDiffStats,
  isLatexPath,
  normalizePath,
  pickTargetPath,
  resolveCandidateFromOutput,
} from "./agentPatchEdits";
import {
  extractPaperLinkFromPrompt,
  inferPaperPromptAction,
  resolveAgentPaperContextForPrompt,
} from "./agentPaperContext";
import {
  executePaperLinkFlow,
  resolvePaperCommandLink,
  resolvePaperFlowAction,
} from "./agentPaperActions";
import { compileProposalPreviewWithAutoFix } from "./agentProposalPreviewCompile";
import { buildAnalysisPrompt, buildTaskExecutionPrompt } from "./agentTaskPrompt";
import { runAgentThroughEvents } from "./agentRunEvents";

const MAX_AGENT_MESSAGES = 200;

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
  taskModelOverride?: string | null;
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
    taskModelOverride,
  } = params;

  const prompt = agentPrompt.trim();
  const parsed = parseAgentPrompt(prompt);
  const commitIntent = resolveAgentCommitIntent(prompt);
  const { targetPath, explicitPath } = pickTargetPath(prompt, selectedFile);
  const withMemoryContext = (basePrompt: string) => basePrompt;

  setAgentProposal(null);
  setAgentRunId(null);
  pushMessage(setAgentMessages, {
    id: nextAgentId("user"),
    role: "user",
    text: prompt,
    format: "plain",
  });
  setAgentPrompt("");
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
          workflowId: "latex.review_fix",
          callsite: "latex.overlay",
          prompt: withMemoryContext(reviewPrompt),
          contextRefs: selectedFile ? [`file:${selectedFile}`] : [],
          setAgentRunId,
          modelOverride: taskModelOverride ?? undefined,
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
        const { insertions, deletions, changedLines, diffBlocks } = computeDiffStats(
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
          commitIntent,
          summary: t("agent.proposalReady"),
          analysisPrompt: buildAnalysisPrompt(prompt, fixedContent, targetPath),
          insertions,
          deletions,
          changedLines,
          diffBlocks,
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
      const queryLines = queries.map((item) => `- ${item}`).join("\n");
      const queryBlock = buildToolSearchQueryBlock(queries);
      const analysisPrompt = [
        "You are a citation verifier with an internal programmatic tool runtime.",
        "The runtime will execute tool_search in a provider-agnostic way.",
        "Assess if each reference appears real and linked to evidence.",
        "Return concise sections: PASS, WARNING, ACTION, SOURCES.",
        "",
        "Reference queries:",
        queryLines,
        "",
        queryBlock,
      ].join("\n");
      const response = await runAgentThroughEvents({
        activeProjectId,
        workflowId: "latex.reference_check",
        callsite: "latex.overlay",
        prompt: withMemoryContext(analysisPrompt),
        contextRefs: selectedFile ? [`file:${selectedFile}`] : [],
        setAgentRunId,
        modelOverride: taskModelOverride ?? undefined,
      });
      pushAgentMessage(cleanAgentOutput(response.output), "markdown");
      setAgentPhase("done");
      setAgentStatusKey("agent.statusDone");
      return;
    }

    if (parsed.kind === "command" && parsed.command === "paper") {
      const link = resolvePaperCommandLink(parsed.args);
      if (!link) {
        throw new Error(t("agent.command.paper.requiresLink"));
      }
      await executePaperLinkFlow({
        activeProjectId,
        link,
        action: resolvePaperFlowAction(parsed.args),
        instruction: parsed.args,
        t,
        withMemoryContext,
        setAgentRunId,
        modelOverride: taskModelOverride ?? undefined,
        pushAgentMessage,
        normalizeOutput: cleanAgentOutput,
      });
      setAgentPhase("done");
      setAgentStatusKey("agent.statusDone");
      return;
    }

    const inferredAction = inferPaperPromptAction(prompt);
    const inferredLink = extractPaperLinkFromPrompt(prompt);
    if (parsed.kind === "plain" && inferredLink && inferredAction !== "none") {
      await executePaperLinkFlow({
        activeProjectId,
        link: inferredLink,
        action: resolvePaperFlowAction(prompt),
        instruction: prompt,
        t,
        withMemoryContext,
        setAgentRunId,
        modelOverride: taskModelOverride ?? undefined,
        pushAgentMessage,
        normalizeOutput: cleanAgentOutput,
      });
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
    const { paperContextBlock, paperContextRef } = await resolveAgentPaperContextForPrompt({
      projectId: activeProjectId,
      prompt,
      t,
    });

    const taskPrompt = buildTaskExecutionPrompt({
      userPrompt: prompt,
      targetPath,
      fileContent: originalContent,
      paperContext: paperContextBlock,
    });
    const taskRefs = Array.from(
      new Set([
        `file:${targetPath}`,
        ...(selectedFile ? [`file:${selectedFile}`] : []),
        ...(paperContextRef ? [`paper:${paperContextRef}`] : []),
      ]),
    );
    const response = await runAgentThroughEvents({
      activeProjectId,
      workflowId: "latex.edit",
      callsite: "latex.overlay",
      prompt: withMemoryContext(taskPrompt),
      contextRefs: taskRefs,
      setAgentRunId,
      modelOverride: taskModelOverride ?? undefined,
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
      let previewCandidate = resolved.candidate;
      if (isLatexPath(targetPath)) {
        try {
          previewCandidate = await compileProposalPreviewWithAutoFix({
            activeProjectId,
            targetPath,
            candidateContent: resolved.candidate,
            withMemoryContext,
            setAgentRunId,
            runCompilePass,
            normalizeOutput: cleanAgentOutput,
          });
        } catch (compileError) {
          await runtimeLogWrite("WARN", `agent_preview_compile_failed: ${String(compileError)}`).catch(() => undefined);
        }
      }
      const { insertions, deletions, changedLines, diffBlocks } = computeDiffStats(
        originalContent,
        previewCandidate,
      );
      if (selectedFile !== targetPath) {
        setSelectedFile(targetPath);
      }
      setEditorContent(previewCandidate);
      setAgentProposal({
        id: `proposal-${Date.now()}-task`,
        targetPath,
        originalContent,
        candidateContent: previewCandidate,
        commitIntent,
        summary: t("agent.proposalReady"),
        analysisPrompt: buildAnalysisPrompt(prompt, previewCandidate, targetPath),
        insertions,
        deletions,
        changedLines,
        diffBlocks,
        previewApplied: true,
      });
      pushAgentMessage(t("agent.proposalPreviewed"));
    }

    setAgentPhase("done");
    setAgentStatusKey("agent.statusDone");
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    if (rawMessage === "agent.run.cancelled") {
      setAgentPhase("done");
      setAgentStatusKey("agent.statusDone");
      setToast({ type: "info", message: t("agent.run.cancelled") });
      return;
    }
    const toastMessage = rawMessage === "agent.run.timeout"
      || rawMessage === "agent.run.timeout.total"
      ? t("agent.run.timeout")
      : rawMessage === "agent.run.timeout.inactive"
        ? t("agent.run.timeout.inactive")
      : rawMessage === "agent.run.failed"
        ? t("agent.run.failed")
      : rawMessage === "agent.paper.invalidLink"
        ? t("agent.paper.invalidLink")
      : rawMessage === "agent.paper.importResolveFailed"
        ? t("agent.paper.importResolveFailed")
        : rawMessage;
    setAgentPhase("error");
    setAgentStatusKey("agent.statusError");
    setToast({ type: "error", message: toastMessage });
  }
}



