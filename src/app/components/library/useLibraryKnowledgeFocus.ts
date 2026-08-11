import { useEffect, useRef, useState } from "react";
import type { KnowledgeDocumentFocusRequest } from "../../../shared/types/app";
import { isSameLibraryPath } from "../../../shared/utils/libraryPath";
import { knowledgeFocusPage } from "../knowledge/knowledgeDocumentFocus";

export function useLibraryKnowledgeFocus(params: {
  request: KnowledgeDocumentFocusRequest | null;
  projectId: string | null;
  selectedPath: string | null;
  viewMode: "bib" | "pdf" | "compare";
  hasPdf: boolean;
  requestPdfOpen: () => void;
  jumpToPage: (page: number) => void;
}) {
  const [handledToken, setHandledToken] = useState<number | null>(null);
  const requestedTokenRef = useRef<number | null>(null);
  const {
    request,
    projectId,
    selectedPath,
    viewMode,
    hasPdf,
    requestPdfOpen,
    jumpToPage,
  } = params;

  useEffect(() => {
    if (
      !request
      || !projectId
      || !selectedPath
      || request.projectId !== projectId
      || !isSameLibraryPath(request.path, selectedPath)
      || handledToken === request.token
    ) return;
    const page = knowledgeFocusPage(request);
    if (!page) {
      return;
    }
    if (viewMode !== "pdf" || !hasPdf) {
      if (requestedTokenRef.current !== request.token) {
        requestedTokenRef.current = request.token;
        requestPdfOpen();
      }
      return;
    }
    jumpToPage(page);
    setHandledToken(request.token);
  }, [handledToken, hasPdf, jumpToPage, projectId, request, requestPdfOpen, selectedPath, viewMode]);

  return request && handledToken !== request.token ? request : null;
}
