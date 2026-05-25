import { readFileBinary } from "../api/workspace";
import { extensionOfPath } from "./codeLanguage";

function pdfMimeType(relativePath: string): string {
  const extension = extensionOfPath(relativePath);
  switch (extension) {
    case "pdf":
      return "application/pdf";
    default:
      return "application/octet-stream";
  }
}

export async function buildWorkspacePreviewBlobUrl(
  projectId: string | null,
  relativePath: string | null,
): Promise<string | null> {
  const source = await buildWorkspacePreviewBinarySource(projectId, relativePath);
  return source?.objectUrl ?? null;
}

export type WorkspacePreviewBinarySource = {
  relativePath: string;
  objectUrl: string;
  bytes: Uint8Array;
};

export function createWorkspacePreviewDocumentData(source: WorkspacePreviewBinarySource): { data: Uint8Array } {
  return { data: new Uint8Array(source.bytes) };
}

export async function buildWorkspacePreviewBinarySource(
  projectId: string | null,
  relativePath: string | null,
): Promise<WorkspacePreviewBinarySource | null> {
  if (!projectId || !relativePath) {
    return null;
  }
  const file = await readFileBinary(projectId, relativePath);
  const bytes = new Uint8Array(file.bytes);
  const blob = new Blob([bytes], { type: pdfMimeType(relativePath) });
  return {
    relativePath: file.relativePath,
    objectUrl: URL.createObjectURL(blob),
    bytes,
  };
}

export function revokeObjectUrl(url: string | null | undefined) {
  if (typeof url === "string" && url.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}

