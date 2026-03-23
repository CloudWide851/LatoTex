import type {
  Ack,
  LibraryCitationSummary,
  LibraryPdfPreview,
  LibraryTranslateResult,
  LibraryTranslateStartResult,
  LibraryTranslateStatus,
  LibraryZoteroSyncResult,
  ResourceNode,
} from "../types/app";
import { invokeCommand } from "./core";

export function getLibraryTree(projectId: string): Promise<ResourceNode[]> {
  return invokeCommand<ResourceNode[]>("library_tree", { input: { projectId } });
}

export function rescanLibrary(projectId: string): Promise<Ack> {
  return invokeCommand<Ack>("library_rescan", { input: { projectId } });
}

export function importLibraryPdf(projectId: string): Promise<Ack | null> {
  return invokeCommand<Ack | null>("library_import_pdf", { input: { projectId } });
}

export function importLibraryLink(projectId: string, link: string): Promise<Ack> {
  return invokeCommand<Ack>("library_import_link", { input: { projectId, link } });
}

export function syncLibraryZotero(input: {
  projectId: string;
  ownerId: string;
  apiKey: string;
  scope?: "users" | "groups";
}): Promise<LibraryZoteroSyncResult> {
  return invokeCommand<LibraryZoteroSyncResult>("library_zotero_sync", {
    input: {
      projectId: input.projectId,
      ownerId: input.ownerId,
      apiKey: input.apiKey,
      scope: input.scope ?? "users",
    },
  });
}

export function translateLibraryDocument(input: {
  projectId: string;
  relativePath: string;
  targetLanguage?: string;
  modelOverride?: string;
}): Promise<LibraryTranslateResult> {
  return invokeCommand<LibraryTranslateResult>("library_translate_document", {
    input: {
      projectId: input.projectId,
      relativePath: input.relativePath,
      targetLanguage: input.targetLanguage,
      modelOverride: input.modelOverride,
    },
  });
}

export function translateLibraryDocumentStart(input: {
  projectId: string;
  relativePath: string;
  targetLanguage?: string;
  modelOverride?: string;
}): Promise<LibraryTranslateStartResult> {
  return invokeCommand<LibraryTranslateStartResult>("library_translate_start", {
    input: {
      projectId: input.projectId,
      relativePath: input.relativePath,
      targetLanguage: input.targetLanguage,
      modelOverride: input.modelOverride,
    },
  });
}

export function translateLibraryDocumentStatus(taskId: string): Promise<LibraryTranslateStatus> {
  return invokeCommand<LibraryTranslateStatus>("library_translate_status", {
    input: { taskId },
  });
}

export function libraryCitationSummary(
  projectId: string,
  relativePath: string,
): Promise<LibraryCitationSummary> {
  return invokeCommand<LibraryCitationSummary>("library_citation_summary", {
    input: { projectId, relativePath },
  });
}

export function libraryResolvePdfPreview(
  projectId: string,
  relativePath: string,
): Promise<LibraryPdfPreview> {
  return invokeCommand<LibraryPdfPreview>("library_resolve_pdf_preview", {
    input: { projectId, relativePath },
  });
}
