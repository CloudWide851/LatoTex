import { referenceCheck, runAgent, runtimeLogWrite } from "../../shared/api/desktop";
import type { Dispatch, SetStateAction } from "react";
import { extractReferenceQueries, parseAgentPrompt } from "./agentCommands";

const MAX_AGENT_MESSAGES = 200;

type AgentMessageSetter = Dispatch<SetStateAction<{ id: string; role: "user" | "agent"; text: string }[]>>;

type AgentPhase = "idle" | "running" | "done" | "error";
type AgentStatusKey =
  | "agent.statusIdle"
  | "agent.statusRunning"
  | "agent.statusDone"
  | "agent.statusError";

export async function runAgentWorkflow(params: {
  activeProjectId: string;
  agentPrompt: string;
  editorContent: string;
  selectedFile: string | null;
  t: (key: any) => string;
  setAgentMessages: AgentMessageSetter;
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
  setAgentMessages((prev) =>
    [
      ...prev,
      {
        id: `${Date.now()}-user`,
        role: "user" as const,
        text: prompt,
      },
    ].slice(-MAX_AGENT_MESSAGES),
  );
  setAgentPrompt("");
  setAgentCollapsed(false);
  setAgentPhase("running");
  setAgentStatusKey("agent.statusRunning");

  const pushAgentMessage = (text: string) => {
    setAgentMessages((prev) =>
      [
        ...prev,
        {
          id: `${Date.now()}-agent`,
          role: "agent" as const,
          text,
        },
      ].slice(-MAX_AGENT_MESSAGES),
    );
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

      const extraInstruction = parsed.args ? `\nAdditional instruction: ${parsed.args}` : "";
      let fixed = false;
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
        let candidate = response.output.trim();
        const fenced = candidate.match(/```(?:latex|tex)?\s*([\s\S]*?)```/i);
        if (fenced?.[1]) {
          candidate = fenced[1].trim();
        }
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
          break;
        }
      }
      if (fixed) {
        pushAgentMessage(t("agent.command.review.fixed"));
        setToast({ type: "info", message: t("toast.compileSuccess") });
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
      pushAgentMessage(response.output);
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
    pushAgentMessage(response.output);
    setAgentPhase("done");
    setAgentStatusKey("agent.statusDone");
  } catch (error) {
    setAgentPhase("error");
    setAgentStatusKey("agent.statusError");
    setToast({ type: "error", message: String(error) });
  }
}
