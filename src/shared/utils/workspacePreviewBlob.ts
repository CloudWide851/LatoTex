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
  if (!projectId || !relativePath) {
    return null;
  }
  const file = await readFileBinary(projectId, relativePath);
  const bytes = new Uint8Array(file.bytes);
  const blob = new Blob([bytes], { type: pdfMimeType(relativePath) });
  return URL.createObjectURL(blob);
}

export function revokeObjectUrl(url: string | null | undefined) {
  if (typeof url === "string" && url.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}

