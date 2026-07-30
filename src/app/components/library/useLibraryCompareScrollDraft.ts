import { useCallback, useEffect, useRef } from "react";
import type { PdfScrollAnchor } from "./libraryPdfScrollState";
import type { LibraryComparePane, LibraryViewerSession } from "./libraryViewerSessionStore";

const COMPARE_SCROLL_PERSIST_DELAY_MS = 220;

type SetLibraryViewerSession = (
  next:
    | Partial<LibraryViewerSession>
    | ((current: LibraryViewerSession) => LibraryViewerSession),
) => void;

export function useLibraryCompareScrollDraft(params: {
  projectId: string | null;
  selectedPath: string | null;
  session: LibraryViewerSession;
  setSession: SetLibraryViewerSession;
}) {
  const { projectId, selectedPath, session, setSession } = params;
  const persistTimerRef = useRef<number | null>(null);
  const sourceAnchorRef = useRef(session.compareSourceScrollAnchor);
  const sourceRatioRef = useRef(session.compareSourceScrollRatio);
  const translatedAnchorRef = useRef(session.compareTranslatedScrollAnchor);
  const translatedRatioRef = useRef(session.compareTranslatedScrollRatio);
  const leaderRef = useRef<LibraryComparePane>(session.compareSyncLeader);

  const flushPending = useCallback(() => {
    if (persistTimerRef.current !== null && typeof window !== "undefined") {
      window.clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    setSession((current) => ({
      ...current,
      compareSourceScrollAnchor: sourceAnchorRef.current,
      compareSourceScrollRatio: sourceRatioRef.current,
      compareTranslatedScrollAnchor: translatedAnchorRef.current,
      compareTranslatedScrollRatio: translatedRatioRef.current,
      compareSyncLeader: leaderRef.current,
    }));
  }, [setSession]);

  const schedulePersist = useCallback(() => {
    if (typeof window === "undefined") {
      flushPending();
      return;
    }
    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current);
    }
    persistTimerRef.current = window.setTimeout(() => {
      persistTimerRef.current = null;
      flushPending();
    }, COMPARE_SCROLL_PERSIST_DELAY_MS);
  }, [flushPending]);

  useEffect(() => {
    sourceAnchorRef.current = session.compareSourceScrollAnchor;
    sourceRatioRef.current = session.compareSourceScrollRatio;
    translatedAnchorRef.current = session.compareTranslatedScrollAnchor;
    translatedRatioRef.current = session.compareTranslatedScrollRatio;
    leaderRef.current = session.compareSyncLeader;
  }, [
    session.compareSourceScrollAnchor,
    session.compareSourceScrollRatio,
    session.compareTranslatedScrollAnchor,
    session.compareTranslatedScrollRatio,
    session.compareSyncLeader,
  ]);

  useEffect(() => () => {
    if (persistTimerRef.current !== null) {
      flushPending();
    }
  }, [flushPending, projectId, selectedPath]);

  const setCompareSourceScrollAnchor = useCallback((next: PdfScrollAnchor) => {
    sourceAnchorRef.current = next;
    schedulePersist();
  }, [schedulePersist]);

  const setCompareSourceScrollRatio = useCallback((next: number) => {
    sourceRatioRef.current = next;
    schedulePersist();
  }, [schedulePersist]);

  const setCompareTranslatedScrollAnchor = useCallback((next: PdfScrollAnchor) => {
    translatedAnchorRef.current = next;
    schedulePersist();
  }, [schedulePersist]);

  const setCompareTranslatedScrollRatio = useCallback((next: number) => {
    translatedRatioRef.current = next;
    schedulePersist();
  }, [schedulePersist]);

  const markComparePaneActive = useCallback((pane: LibraryComparePane) => {
    if (leaderRef.current === pane) {
      return;
    }
    leaderRef.current = pane;
    schedulePersist();
  }, [schedulePersist]);

  const getCompareScrollDraft = useCallback(() => ({
    compareSourceScrollAnchor: sourceAnchorRef.current,
    compareSourceScrollRatio: sourceRatioRef.current,
    compareTranslatedScrollAnchor: translatedAnchorRef.current,
    compareTranslatedScrollRatio: translatedRatioRef.current,
    compareSyncLeader: leaderRef.current,
  }), []);

  return {
    setCompareSourceScrollAnchor,
    setCompareSourceScrollRatio,
    setCompareTranslatedScrollAnchor,
    setCompareTranslatedScrollRatio,
    markComparePaneActive,
    getCompareScrollDraft,
  };
}
