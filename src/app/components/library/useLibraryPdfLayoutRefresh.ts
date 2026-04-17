import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { WORKSPACE_LAYOUT_REFRESH_EVENT } from "../../hooks/workspaceLayoutRefresh";

const DEFAULT_VIEWPORT_WIDTH = 920;

export function useLibraryPdfLayoutRefresh(params: {
  scrollRef: MutableRefObject<HTMLDivElement | null>;
  pagesLength: number;
  setViewportWidth: Dispatch<SetStateAction<number>>;
  markViewerLayoutDirty: () => void;
  restoreScrollAnchor: () => void;
}) {
  const {
    scrollRef,
    pagesLength,
    setViewportWidth,
    markViewerLayoutDirty,
    restoreScrollAnchor,
  } = params;
  const refreshRafRef = useRef<number | null>(null);

  const scheduleViewerLayoutRefresh = useCallback(() => {
    if (typeof window === "undefined" || refreshRafRef.current !== null) {
      return;
    }
    refreshRafRef.current = window.requestAnimationFrame(() => {
      refreshRafRef.current = null;
      if (!scrollRef.current) {
        return;
      }
      setViewportWidth(scrollRef.current.clientWidth || DEFAULT_VIEWPORT_WIDTH);
      markViewerLayoutDirty();
      restoreScrollAnchor();
    });
  }, [markViewerLayoutDirty, restoreScrollAnchor, scrollRef, setViewportWidth]);

  useEffect(() => {
    return () => {
      if (refreshRafRef.current !== null) {
        window.cancelAnimationFrame(refreshRafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!scrollRef.current || pagesLength === 0) {
      return;
    }
    markViewerLayoutDirty();
    if (typeof ResizeObserver === "undefined") {
      setViewportWidth(scrollRef.current.clientWidth || DEFAULT_VIEWPORT_WIDTH);
      restoreScrollAnchor();
      return;
    }
    const observer = new ResizeObserver(() => {
      scheduleViewerLayoutRefresh();
    });
    observer.observe(scrollRef.current);
    scheduleViewerLayoutRefresh();
    return () => observer.disconnect();
  }, [
    markViewerLayoutDirty,
    pagesLength,
    restoreScrollAnchor,
    scheduleViewerLayoutRefresh,
    scrollRef,
    setViewportWidth,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.addEventListener(
      WORKSPACE_LAYOUT_REFRESH_EVENT,
      scheduleViewerLayoutRefresh as EventListener,
    );
    return () => {
      window.removeEventListener(
        WORKSPACE_LAYOUT_REFRESH_EVENT,
        scheduleViewerLayoutRefresh as EventListener,
      );
    };
  }, [scheduleViewerLayoutRefresh]);

  return scheduleViewerLayoutRefresh;
}
