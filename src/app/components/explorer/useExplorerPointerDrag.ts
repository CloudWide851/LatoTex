import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  WORKSPACE_REFERENCE_TARGET_ATTR,
  dispatchWorkspaceReferenceDrop,
} from "../../../shared/events/workspaceReferenceDrop";

type ExplorerNodeKind = "file" | "directory";

type ExplorerPointerDragSession = {
  pointerId: number;
  captureTarget: HTMLElement | null;
  sourcePath: string;
  sourceName: string;
  sourceKind: ExplorerNodeKind;
  projectId: string | null;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  active: boolean;
  bodyStyleSnapshot: {
    userSelect: string;
    cursor: string;
  } | null;
};

type ExplorerPointerDragParams = {
  rootRef: MutableRefObject<HTMLDivElement | null>;
  onMove?: (sourcePath: string, targetPath: string) => Promise<void> | void;
  projectId?: string | null;
  expandedMap: Record<string, boolean>;
  onExpandDirectory: (path: string) => void;
};

function normalizeExplorerPath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function joinPath(parent: string, name: string): string {
  if (!parent) {
    return name;
  }
  return `${parent}/${name}`;
}

function resolveDroppedTargetPath(sourcePath: string, targetDirectoryPath: string): string | null {
  const normalizedSource = normalizeExplorerPath(sourcePath);
  if (!normalizedSource) {
    return null;
  }
  const fileName = normalizedSource.split("/").pop()?.trim() ?? "";
  if (!fileName) {
    return null;
  }
  const normalizedTargetDirectory = normalizeExplorerPath(targetDirectoryPath);
  if (
    normalizedTargetDirectory === normalizedSource
    || normalizedTargetDirectory.startsWith(`${normalizedSource}/`)
  ) {
    return null;
  }
  const nextTargetPath = joinPath(normalizedTargetDirectory, fileName);
  return nextTargetPath === normalizedSource ? null : nextTargetPath;
}

function elementAtPoint(clientX: number, clientY: number): Element | null {
  if (typeof document === "undefined" || typeof document.elementFromPoint !== "function") {
    return null;
  }
  return document.elementFromPoint(clientX, clientY);
}

export function useExplorerPointerDrag(params: ExplorerPointerDragParams) {
  const { rootRef, onMove, projectId, expandedMap, onExpandDirectory } = params;
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const [dragSourcePath, setDragSourcePath] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<{
    name: string;
    x: number;
    y: number;
    active: boolean;
  } | null>(null);
  const dragSessionRef = useRef<ExplorerPointerDragSession | null>(null);
  const onMoveRef = useRef(onMove);
  const projectIdRef = useRef(projectId);
  const expandedMapRef = useRef(expandedMap);
  const onExpandDirectoryRef = useRef(onExpandDirectory);
  const hoverExpandTimerRef = useRef<number | null>(null);
  const hoverExpandPathRef = useRef<string | null>(null);
  const suppressClickRef = useRef(false);
  const suppressClickTimerRef = useRef<number | null>(null);

  onMoveRef.current = onMove;
  projectIdRef.current = projectId;
  expandedMapRef.current = expandedMap;
  onExpandDirectoryRef.current = onExpandDirectory;

  const clearHoverExpandTimer = useCallback(() => {
    if (hoverExpandTimerRef.current !== null && typeof window !== "undefined") {
      window.clearTimeout(hoverExpandTimerRef.current);
      hoverExpandTimerRef.current = null;
    }
    hoverExpandPathRef.current = null;
  }, []);

  const suppressNextClick = useCallback((durationMs = 0) => {
    suppressClickRef.current = true;
    if (suppressClickTimerRef.current !== null) {
      window.clearTimeout(suppressClickTimerRef.current);
    }
    suppressClickTimerRef.current = window.setTimeout(() => {
      suppressClickRef.current = false;
      suppressClickTimerRef.current = null;
    }, durationMs);
  }, []);

  const clearPointerDrag = useCallback((updateState = true) => {
    const session = dragSessionRef.current;
    dragSessionRef.current = null;
    clearHoverExpandTimer();

    if (session?.bodyStyleSnapshot && typeof document !== "undefined") {
      document.body.style.userSelect = session.bodyStyleSnapshot.userSelect;
      document.body.style.cursor = session.bodyStyleSnapshot.cursor;
    }
    if (session?.captureTarget && typeof session.captureTarget.releasePointerCapture === "function") {
      try {
        session.captureTarget.releasePointerCapture(session.pointerId);
      } catch {
        // The browser may already have released capture before lostpointercapture.
      }
    }
    if (updateState) {
      setDragSourcePath(null);
      setDragPreview(null);
      setDropTargetPath(null);
    }
  }, [clearHoverExpandTimer]);

  const cancelPointerDrag = useCallback(() => {
    const wasActive = dragSessionRef.current?.active === true;
    clearPointerDrag();
    if (wasActive) {
      suppressNextClick(250);
    }
  }, [clearPointerDrag, suppressNextClick]);

  const scheduleDirectoryAutoExpand = useCallback((path: string) => {
    if (
      !path
      || expandedMapRef.current[path] !== false
      || hoverExpandPathRef.current === path
    ) {
      return;
    }
    clearHoverExpandTimer();
    hoverExpandPathRef.current = path;
    hoverExpandTimerRef.current = window.setTimeout(() => {
      onExpandDirectoryRef.current(path);
      hoverExpandTimerRef.current = null;
      hoverExpandPathRef.current = null;
    }, 420);
  }, [clearHoverExpandTimer]);

  const resolveReferenceTargetFromPoint = useCallback((clientX: number, clientY: number): Element | null => {
    const target = elementAtPoint(clientX, clientY);
    return target?.closest(`[${WORKSPACE_REFERENCE_TARGET_ATTR}]`) ?? null;
  }, []);

  const resolveDropDirectoryFromPoint = useCallback((clientX: number, clientY: number, sourcePath: string): string | null => {
    if (!onMoveRef.current) {
      return null;
    }
    const target = elementAtPoint(clientX, clientY);
    const directoryNode = target?.closest<HTMLElement>("[data-explorer-drop-directory='true']") ?? null;
    if (directoryNode) {
      const directoryPath = normalizeExplorerPath(directoryNode.dataset.path ?? "");
      if (resolveDroppedTargetPath(sourcePath, directoryPath)) {
        scheduleDirectoryAutoExpand(directoryPath);
        return directoryPath;
      }
      clearHoverExpandTimer();
      return null;
    }
    clearHoverExpandTimer();
    const root = rootRef.current;
    if (!root) {
      return null;
    }
    const rect = root.getBoundingClientRect();
    if (
      clientX >= rect.left
      && clientX <= rect.right
      && clientY >= rect.top
      && clientY <= rect.bottom
      && resolveDroppedTargetPath(sourcePath, "")
    ) {
      return "";
    }
    return null;
  }, [clearHoverExpandTimer, rootRef, scheduleDirectoryAutoExpand]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const session = dragSessionRef.current;
      if (!session || event.pointerId !== session.pointerId) {
        return;
      }
      const dx = event.clientX - session.startX;
      const dy = event.clientY - session.startY;
      const wasActive = session.active;
      session.active = wasActive || Math.hypot(dx, dy) >= 6;
      session.lastX = event.clientX;
      session.lastY = event.clientY;
      if (session.active && !wasActive && typeof document !== "undefined") {
        session.bodyStyleSnapshot = {
          userSelect: document.body.style.userSelect,
          cursor: document.body.style.cursor,
        };
        document.body.style.userSelect = "none";
        document.body.style.cursor = "grabbing";
      }
      setDragPreview({
        name: session.sourceName,
        x: event.clientX,
        y: event.clientY,
        active: session.active,
      });
      if (!session.active) {
        return;
      }
      event.preventDefault();
      const isReferenceTarget = session.sourceKind === "file"
        && Boolean(session.projectId)
        && Boolean(resolveReferenceTargetFromPoint(event.clientX, event.clientY));
      if (isReferenceTarget) {
        clearHoverExpandTimer();
        setDropTargetPath(null);
        return;
      }
      setDropTargetPath(resolveDropDirectoryFromPoint(event.clientX, event.clientY, session.sourcePath));
    };

    const handlePointerUp = (event: PointerEvent) => {
      const session = dragSessionRef.current;
      if (!session || event.pointerId !== session.pointerId) {
        return;
      }
      const referenceTarget = session.active
        && session.sourceKind === "file"
        && Boolean(session.projectId)
        ? resolveReferenceTargetFromPoint(event.clientX, event.clientY)
        : null;
      const nextTargetDirectory = session.active && !referenceTarget
        ? resolveDropDirectoryFromPoint(event.clientX, event.clientY, session.sourcePath)
        : null;
      clearPointerDrag();
      if (!session.active) {
        return;
      }
      suppressNextClick();
      if (referenceTarget && session.projectId) {
        const normalizedPath = normalizeExplorerPath(session.sourcePath);
        if (normalizedPath) {
          dispatchWorkspaceReferenceDrop({
            projectId: session.projectId,
            scope: "workspace",
            paths: [normalizedPath],
          });
        }
        return;
      }
      if (nextTargetDirectory === null) {
        return;
      }
      const nextTargetPath = resolveDroppedTargetPath(session.sourcePath, nextTargetDirectory);
      if (nextTargetPath) {
        void onMoveRef.current?.(session.sourcePath, nextTargetPath);
      }
    };

    const handlePointerCancel = (event: PointerEvent) => {
      const session = dragSessionRef.current;
      if (session && event.pointerId === session.pointerId) {
        cancelPointerDrag();
      }
    };
    const handleLostPointerCapture = (event: PointerEvent) => {
      const session = dragSessionRef.current;
      if (
        session
        && event.pointerId === session.pointerId
        && (!session.captureTarget || event.target === session.captureTarget)
      ) {
        cancelPointerDrag();
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        cancelPointerDrag();
      }
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    window.addEventListener("lostpointercapture", handleLostPointerCapture, true);
    window.addEventListener("blur", cancelPointerDrag);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      window.removeEventListener("lostpointercapture", handleLostPointerCapture, true);
      window.removeEventListener("blur", cancelPointerDrag);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearPointerDrag(false);
      if (suppressClickTimerRef.current !== null) {
        window.clearTimeout(suppressClickTimerRef.current);
        suppressClickTimerRef.current = null;
      }
    };
  }, [
    cancelPointerDrag,
    clearHoverExpandTimer,
    clearPointerDrag,
    resolveDropDirectoryFromPoint,
    resolveReferenceTargetFromPoint,
    suppressNextClick,
  ]);

  const handlePointerDragStart = useCallback((
    event: ReactPointerEvent<HTMLElement>,
    sourcePath: string,
    sourceName: string,
    sourceKind: ExplorerNodeKind,
  ) => {
    const normalizedProjectId = projectIdRef.current?.trim() || null;
    const canReference = sourceKind === "file" && Boolean(normalizedProjectId);
    if ((!onMoveRef.current && !canReference) || event.button !== 0) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, button")) {
      return;
    }
    clearPointerDrag();
    const captureTarget = event.currentTarget;
    if (typeof captureTarget.setPointerCapture === "function") {
      try {
        captureTarget.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is an enhancement; global listeners still own cleanup.
      }
    }
    dragSessionRef.current = {
      pointerId: event.pointerId,
      captureTarget,
      sourcePath,
      sourceName,
      sourceKind,
      projectId: normalizedProjectId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      active: false,
      bodyStyleSnapshot: null,
    };
    setDragSourcePath(sourcePath);
    setDragPreview({
      name: sourceName,
      x: event.clientX,
      y: event.clientY,
      active: false,
    });
  }, [clearPointerDrag]);

  return {
    dragSourcePath,
    dragPreview,
    dropTargetPath,
    suppressClickRef,
    handlePointerDragStart,
  };
}
