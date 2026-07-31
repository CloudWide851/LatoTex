import type {
  Ack,
  DrawExportAssetResult,
  FileReadBinaryResponse,
  FileReadResponse,
  FsOperationInput,
  FsOperationResult,
  MarkdownRunCodeResponse,
  MarkdownRunCodeCapability,
  ResourceNode,
  ScientificCommandResponse,
  SubmissionPackBuildInput,
  SubmissionPackBuildResponse,
  TerminalActivateResponse,
  TerminalReadResponse,
  TerminalStartResponse,
  WorkspaceExportAssetResponse,
  WorkspaceExportPdfResponse,
} from "../types/app";
import { invokeCommand } from "./core";

export function getWorkspaceTree(projectId: string): Promise<ResourceNode[]> {
  return invokeCommand<ResourceNode[]>("workspace_tree", { input: { projectId } });
}

export function workspaceRevealInSystem(projectId: string, relativePath?: string): Promise<Ack> {
  return invokeCommand<Ack>("workspace_reveal_in_system", {
    input: { projectId, relativePath },
  });
}

export function workspaceOpenTerminal(projectId: string, relativePath?: string): Promise<Ack> {
  return invokeCommand<Ack>("workspace_open_terminal", {
    input: { projectId, relativePath },
  });
}

export function terminalStart(
  projectId: string,
  requestId: string,
  relativePath?: string | null,
  size?: { cols?: number; rows?: number },
): Promise<TerminalStartResponse> {
  return invokeCommand<TerminalStartResponse>("terminal_start", {
    input: { projectId, requestId, relativePath, cols: size?.cols, rows: size?.rows },
  });
}

export function terminalCancelStart(requestId: string): Promise<Ack> {
  return invokeCommand<Ack>("terminal_cancel_start", {
    input: { requestId },
  });
}

export function terminalActivateResearchEnv(
  projectId: string,
  sessionId: string,
  retry = true,
): Promise<TerminalActivateResponse> {
  return invokeCommand<TerminalActivateResponse>("terminal_activate_research_env", {
    input: { projectId, sessionId, retry },
  });
}

export function terminalWrite(sessionId: string, data: string): Promise<Ack> {
  return invokeCommand<Ack>("terminal_write", {
    input: { sessionId, data },
  });
}

export function terminalRead(sessionId: string, cursor?: number): Promise<TerminalReadResponse> {
  return invokeCommand<TerminalReadResponse>("terminal_read", {
    input: { sessionId, cursor },
  });
}

export function terminalResize(sessionId: string, cols: number, rows: number): Promise<Ack> {
  return invokeCommand<Ack>("terminal_resize", {
    input: { sessionId, cols, rows },
  });
}

export function terminalStop(sessionId: string): Promise<Ack> {
  return invokeCommand<Ack>("terminal_stop", {
    input: { sessionId },
  });
}

export function markdownRunCode(input: {
  projectId: string;
  relativePath?: string | null;
  language: string;
  code: string;
}): Promise<MarkdownRunCodeResponse> {
  return invokeCommand<MarkdownRunCodeResponse>("markdown_run_code", { input });
}

export function markdownRunCodeCapabilities(): Promise<MarkdownRunCodeCapability[]> {
  return invokeCommand<MarkdownRunCodeCapability[]>("markdown_run_code_capabilities");
}

export function executeScientificCommand(input: {
  projectId: string;
  pluginId: string;
  commandId: "scientific.runFile" | "scientific.runSelection" | "scientific.openExternal";
  relativePath: string;
  code?: string;
}): Promise<ScientificCommandResponse> {
  return invokeCommand<ScientificCommandResponse>("scientific_command_execute", { input });
}

export function readFile(projectId: string, relativePath: string): Promise<FileReadResponse> {
  return invokeCommand<FileReadResponse>("file_read", { input: { projectId, relativePath } });
}

export function readFileBinary(
  projectId: string,
  relativePath: string,
): Promise<FileReadBinaryResponse> {
  return invokeCommand<FileReadBinaryResponse>("file_read_binary", {
    input: { projectId, relativePath },
  });
}

export function writeFile(
  projectId: string,
  relativePath: string,
  content: string,
  knowledgeApprovalToken?: string,
): Promise<Ack> {
  return invokeCommand<Ack>("file_write", {
    input: { projectId, relativePath, content, knowledgeApprovalToken },
  });
}

export function writeFileBinary(
  projectId: string,
  relativePath: string,
  bytes: Uint8Array | number[],
  knowledgeApprovalToken?: string,
): Promise<Ack> {
  return invokeCommand<Ack>("file_write_binary", {
    input: {
      projectId,
      relativePath,
      bytes: Array.from(bytes),
      knowledgeApprovalToken,
    },
  });
}

export function drawExportAsset(
  projectId: string,
  relativePath: string,
  bytes: Uint8Array | number[],
): Promise<DrawExportAssetResult> {
  return invokeCommand<DrawExportAssetResult>("draw_export_asset", {
    input: {
      projectId,
      relativePath,
      bytes: Array.from(bytes),
    },
  });
}

export function workspaceExportPdf(
  projectId: string,
  defaultFileName: string,
  bytes: Uint8Array | number[],
): Promise<WorkspaceExportPdfResponse | null> {
  return invokeCommand<WorkspaceExportPdfResponse | null>("workspace_export_pdf", {
    input: {
      projectId,
      defaultFileName,
      bytes: Array.from(bytes),
    },
  });
}

export function workspaceExportAsset(
  projectId: string,
  defaultRelativeDir: string,
  defaultFileName: string,
  bytes: Uint8Array | number[],
): Promise<WorkspaceExportAssetResponse | null> {
  return invokeCommand<WorkspaceExportAssetResponse | null>("workspace_export_asset", {
    input: {
      projectId,
      defaultRelativeDir,
      defaultFileName,
      bytes: Array.from(bytes),
    },
  });
}

export function fsOperation(input: FsOperationInput): Promise<FsOperationResult> {
  return invokeCommand<FsOperationResult>("fs_operation", { input });
}

export function submissionPackBuild(
  input: SubmissionPackBuildInput,
): Promise<SubmissionPackBuildResponse> {
  return invokeCommand<SubmissionPackBuildResponse>("submission_pack_build", { input });
}
