import { useEffect } from "react";

type ToolMode = "select" | "highlight" | "eraser" | "textbox";

export function useLibraryPdfShortcuts(params: {
  enabled: boolean;
  currentPage: number;
  jumpToPage: (next: number) => void;
  setMode: (mode: ToolMode) => void;
  onUndo: () => void;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
}) {
  const { enabled, currentPage, jumpToPage, setMode, onUndo, setZoom } = params;

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const isEditableTarget = (target: EventTarget | null): boolean => {
      const el = target as HTMLElement | null;
      if (!el) {
        return false;
      }
      const tag = el.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") {
        return true;
      }
      return el.isContentEditable;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const hasModifier = event.ctrlKey || event.metaKey;
      if (isEditableTarget(event.target)) {
        return;
      }
      if (!hasModifier) {
        if (key === "v") {
          event.preventDefault();
          setMode("select");
          return;
        }
        if (key === "h") {
          event.preventDefault();
          setMode("highlight");
          return;
        }
        if (key === "e") {
          event.preventDefault();
          setMode("eraser");
          return;
        }
        if (key === "t") {
          event.preventDefault();
          setMode("textbox");
          return;
        }
        if (key === "[") {
          event.preventDefault();
          jumpToPage(currentPage - 1);
          return;
        }
        if (key === "]") {
          event.preventDefault();
          jumpToPage(currentPage + 1);
          return;
        }
        if (key === "-" || key === "_") {
          event.preventDefault();
          setZoom((prev) => Math.max(0.7, Number((prev - 0.1).toFixed(2))));
          return;
        }
        if (key === "=" || key === "+") {
          event.preventDefault();
          setZoom((prev) => Math.min(2.4, Number((prev + 0.1).toFixed(2))));
        }
        return;
      }
      if (!event.shiftKey && key === "z") {
        event.preventDefault();
        onUndo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [currentPage, enabled, jumpToPage, onUndo, setMode, setZoom]);
}
