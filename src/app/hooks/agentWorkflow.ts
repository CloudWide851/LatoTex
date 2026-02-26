import { readFile, referenceCheck, runAgent, runtimeLogWrite } from "../../shared/api/desktop";
import type { Dispatch, SetStateAction } from "react";
import type { AgentChatMessage, AgentFileProposal } from "./agentTypes";
import { extractReferenceQueries, parseAgentPrompt } from "./agentCommands";

const MAX_AGENT_MESSAGES = 200;

type AgentMessageSetter = Dispatch<SetStateAction<AgentChatMessage[]>>;

type AgentPhase = "idle" | "running" | "done" | "error";
type AgentStatusKey =
  | "agent.statusIdle"
  | "agent.statusRunning"
  | "agent.statusDone"
  | "agent.statusError";

function nextAgentId(role: "user" | "agent", suffix = ""): string {
  return `${Date.now()}-${role}${suffix}`;
}

function pushMessage(
  setter: AgentMessageSetter,
  message: AgentChatMessage,
) {
  setter((prev) => [...prev, message].slice(-MAX_AGENT_MESSAGES));
}

function tryDecodeSerializedOutput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return raw;
  }

  try {
    if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === "string" && parsed.trim().length > 0) {
        return parsed;
      }
    }
  } catch {
    // Ignore non-JSON text.
  }

  try {
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      const parsed = JSON.parse(trimmed) as unknown;
      if (typeof parsed === "string" && parsed.trim().length > 0) {
        return parsed;
      }
      if (Array.isArray(parsed)) {
        const firstText = parsed.find((item) => typeof item === "string" && item.trim().length > 0);
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
    // Ignore parse failures and keep raw text.
  }

  return raw;
}

function cleanAgentOutput(raw: string): string {
  return tryDecodeSerializedOutput(raw)
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractFencedLatex(raw: string): string | null {
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

export async function runAgentWorkflow(params: {
  activeProjectId: string;
  agentPrompt: string;
  editorContent: string;
  selectedFile: string | null;
  t: (key: any) => string;
  setAgentMessages: AgentMessageSetter;
  setAgentProposal: (value: AgentFileProposal | null) => void;
  setAgentPrompt: (value: string) => void;
  setAgentCollapsed: (value: boolean) => void;
  setAgentPhase: (value: AgentPhase) => void;
  setAgentStatusKey: (value: AgentStatusKey) => void;
  setToast: (value: { type: "info" | "error"; message: string }) => void;
  setEditorContent: (value: string) => void;
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
    setAgentPrompt,
    setAgentCollapsed,
    setAgentPhase,
    setAgentStatusKey,
    setToast,
    setEditorContent,
    runCompilePass,
  } = params;

  const prompt = agentPrompt.trim();
  const parsed = parseAgentPrompt(prompt);
  setAgentProposal(null);
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

  const pushAgentMessage = (text: string, format: "plain" | "markdown" = "plain", proposalId?: string) => {
    pushMessage(setAgentMessages, {
      id: nextAgentId("agent"),
      role: "agent",
      text,
      format,
      proposalId,
    });
  };

  const targetPath = selectedFile && selectedFile.endsWith(".tex") ? selectedFile : "main.tex";

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

      const extraInstruction = parsed.args ? `\nAdditional instruction: ${parsed.args}` : "";
      let fixed = false;
      let fixedContent = "";
      for (let round = 0; round < 3; round += 1) {
        const reviewPrompt = [
          "You are a LaTeX fixer.",
          "Apply minimal changes so the document compiles.",
          "Return ONLY the full fixed LaTeX document content.",
          "",
          `Compile diagnostics:\n${compileResult.diagnostics.join("\n")}`,
          extraInstruction,
          "",
          "Current LaTeX content:",
          workingContent,
        ].join("\n");
        const response = await runAgent({
          projectId: activeProjectId,
          role: "review",
          prompt: reviewPrompt,
          contextRefs: selectedFile ? [`file:${selectedFile}`] : [],
        });
        const candidate = extractFencedLatex(cleanAgentOutput(response.output));
        if (!candidate) {
          continue;
        }
        workingContent = candidate;
        setEditorContent(candidate);
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
        const proposalId = `proposal-${Date.now()}-review`;
        setAgentProposal({
          id: proposalId,
          targetPath,
          originalContent,
          candidateContent: fixedContent,
          summary: t("agent.proposalReady"),
          analysisPrompt: buildAnalysisPrompt(prompt, fixedContent, targetPath),
        });
        pushAgentMessage(t("agent.proposalReady"), "plain", proposalId);
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
      const response = await runAgent({
        projectId: activeProjectId,
        role: "web_search",
        prompt: analysisPrompt,
        contextRefs: selectedFile ? [`file:${selectedFile}`] : [],
      });
      pushAgentMessage(cleanAgentOutput(response.output), "markdown");
      setAgentPhase("done");
      setAgentStatusKey("agent.statusDone");
      return;
    }

    const response = await runAgent({
      projectId: activeProjectId,
      role: "task",
      prompt,
      contextRefs: selectedFile ? [`file:${selectedFile}`] : [],
    });
    await runtimeLogWrite("INFO", `${t("log.agentRunDone")}, runId=${response.runId}`);
    const normalizedOutput = cleanAgentOutput(response.output);
    pushAgentMessage(normalizedOutput, "markdown");

    const candidate = extractFencedLatex(normalizedOutput);
    if (candidate) {
      const originalContent = await loadOriginalContent({
        activeProjectId,
        targetPath,
        selectedFile,
        editorContent,
      });
      if (candidate.trim() !== originalContent.trim()) {
        const proposalId = `proposal-${Date.now()}-task`;
        setAgentProposal({
          id: proposalId,
          targetPath,
          originalContent,
          candidateContent: candidate,
          summary: t("agent.proposalReady"),
          analysisPrompt: buildAnalysisPrompt(prompt, normalizedOutput, targetPath),
        });
        pushAgentMessage(t("agent.proposalReady"), "plain", proposalId);
      }
    }

    setAgentPhase("done");
    setAgentStatusKey("agent.statusDone");
  } catch (error) {
    setAgentPhase("error");
    setAgentStatusKey("agent.statusError");
    setToast({ type: "error", message: String(error) });
  }
}
