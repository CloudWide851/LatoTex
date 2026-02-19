import { useEffect } from "react";

type ShortcutHandler = () => void;

function isEditableElement(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) {
    return false;
  }
  const tag = element.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") {
    return true;
  }
  return element.isContentEditable;
}

export function useWorkspaceShortcuts(params: {
  handleEditorUndo: ShortcutHandler;
  handleEditorRedo: ShortcutHandler;
  handleSaveFile: ShortcutHandler;
  handleCompile: ShortcutHandler;
  handleExportCompiledPdf: ShortcutHandler;
  handleOpenNewWindow: ShortcutHandler;
}) {
  const {
    handleEditorUndo,
    handleEditorRedo,
    handleSaveFile,
    handleCompile,
    handleExportCompiledPdf,
    handleOpenNewWindow,
  } = params;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const hasModifier = event.ctrlKey || event.metaKey;
      if (!hasModifier) {
        return;
      }
      const key = event.key.toLowerCase();
      const shift = event.shiftKey;
      const macRedo = event.metaKey && shift && key === "z";
      const nonMacRedo = event.ctrlKey && !shift && key === "y";

      if (!shift && key === "z") {
        event.preventDefault();
        handleEditorUndo();
        return;
      }
      if (macRedo || nonMacRedo) {
        event.preventDefault();
        handleEditorRedo();
        return;
      }
      if (shift && key === "s") {
        event.preventDefault();
        handleExportCompiledPdf();
        return;
      }
      if (shift && key === "n") {
        event.preventDefault();
        handleOpenNewWindow();
        return;
      }
      if (!shift && key === "s") {
        event.preventDefault();
        handleSaveFile();
        return;
      }
      if (shift && key === "b") {
        if (!isEditableElement(event.target)) {
          event.preventDefault();
        } else {
          event.preventDefault();
        }
        handleCompile();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [
    handleCompile,
    handleEditorRedo,
    handleEditorUndo,
    handleExportCompiledPdf,
    handleOpenNewWindow,
    handleSaveFile,
  ]);
}
