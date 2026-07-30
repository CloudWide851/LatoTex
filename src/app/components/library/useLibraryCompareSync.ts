import { useCallback, useRef } from "react";
import {
  ensurePdfScrollSyncGroup,
  publishPdfScrollSync,
  type LibraryPdfScrollSyncGroup,
} from "./libraryPdfScrollViewerShared";
import type { LibraryViewerSession } from "./libraryViewerSessionStore";
import { useLibraryCompareScrollDraft } from "./useLibraryCompareScrollDraft";

type SetLibraryViewerSession = (
  next:
    | Partial<LibraryViewerSession>
    | ((current: LibraryViewerSession) => LibraryViewerSession),
) => void;

export function useLibraryCompareSync(params: {
  projectId: string | null;
  selectedPath: string | null;
  session: LibraryViewerSession;
  setSession: SetLibraryViewerSession;
}) {
  const { projectId, selectedPath, session, setSession } = params;
  const compareSyncGroupRef = useRef<LibraryPdfScrollSyncGroup | null>(null);
  const draft = useLibraryCompareScrollDraft({
    projectId,
    selectedPath,
    session,
    setSession,
  });

  const setCompareSyncEnabled = useCallback((enabled: boolean) => {
    const snapshot = draft.getCompareScrollDraft();
    if (enabled) {
      const group = ensurePdfScrollSyncGroup(compareSyncGroupRef);
      if (group) {
        const anchor = snapshot.compareSyncLeader === "translated"
          ? snapshot.compareTranslatedScrollAnchor
          : snapshot.compareSourceScrollAnchor;
        publishPdfScrollSync(group, snapshot.compareSyncLeader, anchor);
      }
    } else {
      compareSyncGroupRef.current = null;
    }
    setSession({
      ...snapshot,
      compareSyncEnabled: enabled,
    });
  }, [draft, setSession]);

  return {
    ...draft,
    compareSyncGroupRef,
    compareSyncEnabled: session.compareSyncEnabled,
    setCompareSyncEnabled,
  };
}
