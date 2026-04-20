import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type MutableRefObject, type PointerEvent as ReactPointerEvent } from "react";

type ExplorerPointerDragSession = {
  inputKind: "mouse" | "pointer";
  pointerId: number;
  sourcePath: string;
  sourceName: string;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  active: boolean;
};

type ExplorerPointerDragParams = {
  rootRef: MutableRefObject<HTMLDivElement | null>;
  onMove?: (sourcePath: string, targetPath: string) => Promise<void> | void;
  expandedMap: Record<string, boolean>;
  onExpandDirectory: (path: string) => void;
};

function isPointerLikeEvent(event: Event | MouseEvent | PointerEvent): event is PointerEvent {
  return event.type.startsWith("pointer") && typeof (event as PointerEvent).pointerId === "number";
}

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

export function useExplorerPointerDrag(params: ExplorerPointerDragParams) {
  const { rootRef, onMove, expandedMap, onExpandDirectory } = params;
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const [dragSourcePath, setDragSourcePath] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<{
    name: string;
    x: number;
    y: number;
    active: boolean;
  } | null>(null);
  const dragSessionRef = useRef<ExplorerPointerDragSession | null>(null);
  const hoverExpandTimerRef = useRef<number | null>(null);
  const hoverExpandPathRef = useRef<string | null>(null);
  const suppressClickRef = useRef(false);

  const clearHoverExpandTimer = useCallback(() => {
    if (hoverExpandTimerRef.current !== null && typeof window !== "undefined") {
      window.clearTimeout(hoverExpandTimerRef.current);
      hoverExpandTimerRef.current = null;
    }
    hoverExpandPathRef.current = null;
  }, []);

  const clearPointerDrag = useCallback(() => {
    dragSessionRef.current = null;
    setDragSourcePath(null);
    setDragPreview(null);
    setDropTargetPath(null);
    clearHoverExpandTimer();
    if (typeof document !== "undefined") {
      document.body.style.removeProperty("user-select");
      document.body.style.removeProperty("cursor");
    }
  }, [clearHoverExpandTimer]);

  const scheduleDirectoryAutoExpand = useCallback((path: string) => {
    if (!path || expandedMap[path] !== false || hoverExpandPathRef.current === path) {
      return;
    }
    clearHoverExpandTimer();
    hoverExpandPathRef.current = path;
    hoverExpandTimerRef.current = window.setTimeout(() => {
      onExpandDirectory(path);
      hoverExpandTimerRef.current = null;
      hoverExpandPathRef.current = null;
    }, 420);
  }, [clearHoverExpandTimer, expandedMap, onExpandDirectory]);

  const resolveDropDirectoryFromPoint = useCallback((clientX: number, clientY: number, sourcePath: string): string | null => {
    if (!onMove || typeof document === "undefined") {
      return null;
    }
    const target = document.elementFromPoint(clientX, clientY);
    const directoryNode = target instanceof HTMLElement
      ? target.closest<HTMLElement>("[data-explorer-drop-directory='true']")
      : null;
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
  }, [clearHoverExpandTimer, onMove, rootRef, scheduleDirectoryAutoExpand]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent | MouseEvent) => {
      const session = dragSessionRef.current;
      if (!session) {
        return;
      }
      if (session.inputKind === "pointer") {
        if (!isPointerLikeEvent(event) || event.pointerId !== session.pointerId) {
          return;
        }
      } else if (isPointerLikeEvent(event)) {
        return;
      }
      const dx = event.clientX - session.startX;
      const dy = event.clientY - session.startY;
      const isActive = session.active || Math.hypot(dx, dy) >= 6;
      session.active = isActive;
      session.lastX = event.clientX;
      session.lastY = event.clientY;
      if (isActive && typeof document !== "undefined") {
        document.body.style.setProperty("user-select", "none");
        document.body.style.setProperty("cursor", "grabbing");
      }
      setDragPreview({
        name: session.sourceName,
        x: event.clientX,
        y: event.clientY,
        active: isActive,
      });
      if (!isActive) {
        return;
      }
      setDropTargetPath(resolveDropDirectoryFromPoint(event.clientX, event.clientY, session.sourcePath));
    };

    const handlePointerEnd = (event: PointerEvent | MouseEvent) => {
      const session = dragSessionRef.current;
      if (!session) {
        return;
      }
      if (session.inputKind === "pointer") {
        if (!isPointerLikeEvent(event) || event.pointerId !== session.pointerId) {
          return;
        }
      } else if (isPointerLikeEvent(event)) {
        return;
      }
      const nextTargetDirectory = session.active
        ? resolveDropDirectoryFromPoint(event.clientX, event.clientY, session.sourcePath)
        : null;
      clearPointerDrag();
      if (!session.active || nextTargetDirectory === null) {
        return;
      }
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
      const nextTargetPath = resolveDroppedTargetPath(session.sourcePath, nextTargetDirectory);
      if (!nextTargetPath) {
        return;
      }
      void onMove?.(session.sourcePath, nextTargetPath);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerEnd);
    window.addEventListener("pointercancel", handlePointerEnd);
    window.addEventListener("mousemove", handlePointerMove);
    window.addEventListener("mouseup", handlePointerEnd);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerEnd);
      window.removeEventListener("pointercancel", handlePointerEnd);
      window.removeEventListener("mousemove", handlePointerMove);
      window.removeEventListener("mouseup", handlePointerEnd);
      clearPointerDrag();
    };
  }, [clearPointerDrag, onMove, resolveDropDirectoryFromPoint]);

  const handlePointerDragStart = useCallback((event: ReactPointerEvent<HTMLElement> | ReactMouseEvent<HTMLElement>, sourcePath: string, sourceName: string) => {
    if (!onMove || event.button !== 0) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, button")) {
      return;
    }
    const inputKind = event.type === "pointerdown" ? "pointer" : "mouse";
    const existingSession = dragSessionRef.current;
    if (
      existingSession
      && existingSession.sourcePath === sourcePath
      && existingSession.startX === event.clientX
      && existingSession.startY === event.clientY
    ) {
      if (existingSession.inputKind === "pointer" || inputKind === "mouse") {
        return;
      }
    }
    dragSessionRef.current = {
      inputKind,
      pointerId: inputKind === "pointer" && "pointerId" in event.nativeEvent
        ? event.nativeEvent.pointerId
        : 1,
      sourcePath,
      sourceName,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      active: false,
    };
    setDragSourcePath(sourcePath);
    setDragPreview({
      name: sourceName,
      x: event.clientX,
      y: event.clientY,
      active: false,
    });
  }, [onMove]);

  return {
    dragSourcePath,
    dragPreview,
    dropTargetPath,
    suppressClickRef,
    handlePointerDragStart,
  };
}
