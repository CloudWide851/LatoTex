import { useCallback, useEffect, useState } from "react";
import {
  defaultLibraryViewerSession,
  loadLibraryViewerSession,
  persistLibraryViewerSession,
  type LibraryViewerSession,
} from "./libraryViewerSessionStore";

type ViewMode = "bib" | "pdf" | "compare";

export function useLibraryViewerSession(params: {
  projectId: string | null;
  selectedPath: string | null;
  fallbackViewMode?: ViewMode | null;
}) {
  const { projectId, selectedPath, fallbackViewMode = "bib" } = params;
  const [session, setSession] = useState<LibraryViewerSession>(() =>
    loadLibraryViewerSession(projectId, selectedPath, fallbackViewMode ?? "bib"),
  );

  useEffect(() => {
    setSession(loadLibraryViewerSession(projectId, selectedPath, fallbackViewMode ?? "bib"));
  }, [fallbackViewMode, projectId, selectedPath]);

  const updateSession = useCallback((
    next:
      | Partial<LibraryViewerSession>
      | ((current: LibraryViewerSession) => LibraryViewerSession),
  ) => {
    setSession((current) => {
      const resolved = typeof next === "function"
        ? next(current)
        : {
            ...current,
            ...next,
          };
      persistLibraryViewerSession(projectId, selectedPath, resolved);
      return resolved;
    });
  }, [projectId, selectedPath]);

  const resetSession = useCallback(() => {
    const next = defaultLibraryViewerSession(fallbackViewMode ?? "bib");
    persistLibraryViewerSession(projectId, selectedPath, next);
    setSession(next);
  }, [fallbackViewMode, projectId, selectedPath]);

  return {
    session,
    setSession: updateSession,
    resetSession,
  };
}
