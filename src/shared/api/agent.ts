import type {
  Ack,
  AgentExecuteStartAccepted,
  AgentRunsRecoverResponse,
  AgentTeamMode,
  EventBatch,
} from "../types/app";
import { invokeCommand } from "./core";

export function executeWorkflowStart(input: {
  projectId: string;
  workflowId: string;
  callsite: string;
  prompt: string;
  contextRefs: string[];
  modelOverride?: string;
  bypassCache?: boolean;
  teamMode?: AgentTeamMode;
  harnessProfileId?: string;
}): Promise<AgentExecuteStartAccepted> {
  return invokeCommand<AgentExecuteStartAccepted>("agent_execute_start", {
    input: {
      projectId: input.projectId,
      workflowId: input.workflowId,
      callsite: input.callsite,
      prompt: input.prompt,
      contextRefs: input.contextRefs,
      modelOverride: input.modelOverride,
      bypassCache: input.bypassCache ?? false,
      teamMode: input.teamMode ?? "auto",
      harnessProfileId: input.harnessProfileId,
    },
  });
}

export function startLatexEdit(input: {
  projectId: string;
  userPrompt: string;
  targetPath: string;
  fileContent: string;
  selectedFile?: string | null;
  paperContextSourcePath?: string | null;
  contextPaths?: string[];
  modelOverride?: string;
  teamMode?: AgentTeamMode;
}): Promise<AgentExecuteStartAccepted> {
  return invokeCommand<AgentExecuteStartAccepted>("latex_edit_start", {
    input: {
      projectId: input.projectId,
      userPrompt: input.userPrompt,
      targetPath: input.targetPath,
      fileContent: input.fileContent,
      selectedFile: input.selectedFile ?? null,
      paperContextSourcePath: input.paperContextSourcePath ?? null,
      contextPaths: input.contextPaths ?? [],
      modelOverride: input.modelOverride,
      teamMode: input.teamMode ?? "auto",
    },
  });
}

export function startLatexReviewFix(input: {
  projectId: string;
  selectedFile: string;
  workingContent: string;
  diagnostics: string[];
  extraInstruction?: string;
  modelOverride?: string;
  teamMode?: AgentTeamMode;
}): Promise<AgentExecuteStartAccepted> {
  return invokeCommand<AgentExecuteStartAccepted>("latex_review_fix_start", {
    input: {
      projectId: input.projectId,
      selectedFile: input.selectedFile,
      workingContent: input.workingContent,
      diagnostics: input.diagnostics,
      extraInstruction: input.extraInstruction,
      modelOverride: input.modelOverride,
      teamMode: input.teamMode ?? "auto",
    },
  });
}

export function startLatexReferenceCheck(input: {
  projectId: string;
  selectedFile?: string | null;
  editorContent: string;
  userHint?: string;
  contextPaths?: string[];
  modelOverride?: string;
  teamMode?: AgentTeamMode;
}): Promise<AgentExecuteStartAccepted> {
  return invokeCommand<AgentExecuteStartAccepted>("latex_reference_check_start", {
    input: {
      projectId: input.projectId,
      selectedFile: input.selectedFile ?? null,
      editorContent: input.editorContent,
      userHint: input.userHint,
      contextPaths: input.contextPaths ?? [],
      modelOverride: input.modelOverride,
      teamMode: input.teamMode ?? "auto",
    },
  });
}

export function startLatexPaperAnalyze(input: {
  projectId: string;
  sourcePath: string;
  instruction?: string;
  modelOverride?: string;
  teamMode?: AgentTeamMode;
}): Promise<AgentExecuteStartAccepted> {
  return invokeCommand<AgentExecuteStartAccepted>("latex_paper_analyze_start", {
    input: {
      projectId: input.projectId,
      sourcePath: input.sourcePath,
      instruction: input.instruction,
      modelOverride: input.modelOverride,
      teamMode: input.teamMode ?? "auto",
    },
  });
}

export function startLatexRebuttalReply(input: {
  projectId: string;
  selectedFile: string;
  editorContent: string;
  reviewComments: string;
  contextPaths?: string[];
  modelOverride?: string;
  teamMode?: AgentTeamMode;
}): Promise<AgentExecuteStartAccepted> {
  return invokeCommand<AgentExecuteStartAccepted>("latex_rebuttal_reply_start", {
    input: {
      projectId: input.projectId,
      selectedFile: input.selectedFile,
      editorContent: input.editorContent,
      reviewComments: input.reviewComments,
      contextPaths: input.contextPaths ?? [],
      modelOverride: input.modelOverride,
      teamMode: input.teamMode ?? "auto",
    },
  });
}

export function startChatWorkflow(input: {
  projectId: string;
  prompt: string;
  contextPaths?: string[];
  modelOverride?: string;
  teamMode?: AgentTeamMode;
}): Promise<AgentExecuteStartAccepted> {
  return invokeCommand<AgentExecuteStartAccepted>("chat_workflow_start", {
    input: {
      projectId: input.projectId,
      prompt: input.prompt,
      contextPaths: input.contextPaths ?? [],
      modelOverride: input.modelOverride,
      teamMode: input.teamMode ?? "auto",
    },
  });
}

export function startCompletionLatex(input: {
  projectId: string;
  selectedFile?: string | null;
  linePrefix: string;
  fullText: string;
  projectSymbols: string[];
  modelOverride?: string;
}): Promise<AgentExecuteStartAccepted> {
  return invokeCommand<AgentExecuteStartAccepted>("completion_latex_start", {
    input: {
      projectId: input.projectId,
      selectedFile: input.selectedFile ?? null,
      linePrefix: input.linePrefix,
      fullText: input.fullText,
      projectSymbols: input.projectSymbols,
      modelOverride: input.modelOverride,
    },
  });
}

export function startGitSummaryWorkflow(input: {
  projectId: string;
  files: string[];
  joinedPatch: string;
}): Promise<AgentExecuteStartAccepted> {
  return invokeCommand<AgentExecuteStartAccepted>("git_summary_workflow_start", {
    input: {
      projectId: input.projectId,
      files: input.files,
      joinedPatch: input.joinedPatch,
    },
  });
}

export function executeWorkflowCancel(runId: string): Promise<Ack> {
  return invokeCommand<Ack>("agent_execute_cancel", { input: { runId } });
}

export function recoverAgentRuns(projectId?: string | null): Promise<AgentRunsRecoverResponse> {
  return invokeCommand<AgentRunsRecoverResponse>("agent_runs_recover", {
    input: { projectId: projectId ?? null },
  });
}

export function getEvents(
  cursor?: number,
  limit = 200,
  runId?: string,
  waitMs?: number,
  excludeKinds?: string[],
): Promise<EventBatch> {
  return invokeCommand<EventBatch>("events_subscribe", {
    query: { cursor, limit, runId, waitMs, excludeKinds },
  });
}
