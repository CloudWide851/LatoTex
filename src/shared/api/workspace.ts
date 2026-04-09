import type {
  Ack,
  DrawExportAssetResult,
  FileReadBinaryResponse,
  FileReadResponse,
  FsOperationInput,
  FsOperationResult,
  ResourceNode,
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

export function writeFile(projectId: string, relativePath: string, content: string): Promise<Ack> {
  return invokeCommand<Ack>("file_write", {
    input: { projectId, relativePath, content },
  });
}

export function writeFileBinary(
  projectId: string,
  relativePath: string,
  bytes: Uint8Array | number[],
): Promise<Ack> {
  return invokeCommand<Ack>("file_write_binary", {
    input: {
      projectId,
      relativePath,
      bytes: Array.from(bytes),
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

export function fsOperation(input: FsOperationInput): Promise<FsOperationResult> {
  return invokeCommand<FsOperationResult>("fs_operation", { input });
}
