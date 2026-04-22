import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { AnnotationTextBox } from "./annotationModel";
import { getAnnotationEditingBox } from "./pdfAnnotationLayerInteraction";
import { normalizeStoredRichHtml, plainTextToRichHtml, richHtmlToPlainText, sanitizeRichTextHtml } from "./textboxRichText";

export function usePdfTextBoxEditing(params: {
  layerRef: MutableRefObject<HTMLDivElement | null>;
  textBoxesRef: MutableRefObject<AnnotationTextBox[]>;
  recentlyCreatedTextBoxIdRef: MutableRefObject<string | null>;
  onTextBoxesChange: (next: AnnotationTextBox[]) => void;
  setEditingTextBoxId: Dispatch<SetStateAction<string | null>>;
  setSelectedTextBoxId: Dispatch<SetStateAction<string | null>>;
  setMenuOpen: Dispatch<SetStateAction<boolean>>;
}) {
  const {
    layerRef,
    textBoxesRef,
    recentlyCreatedTextBoxIdRef,
    onTextBoxesChange,
    setEditingTextBoxId,
    setSelectedTextBoxId,
    setMenuOpen,
  } = params;

  const updateTextBoxes = useCallback((updater: (current: AnnotationTextBox[]) => AnnotationTextBox[]) => {
    const next = updater(textBoxesRef.current);
    textBoxesRef.current = next;
    onTextBoxesChange(next);
    return next;
  }, [onTextBoxesChange, textBoxesRef]);

  const deleteTextBox = useCallback((boxId: string) => {
    if (recentlyCreatedTextBoxIdRef.current === boxId) {
      recentlyCreatedTextBoxIdRef.current = null;
    }
    updateTextBoxes((current) => current.filter((item) => item.id !== boxId));
    setEditingTextBoxId((current) => (current === boxId ? null : current));
    setSelectedTextBoxId((current) => (current === boxId ? null : current));
    setMenuOpen(false);
  }, [
    recentlyCreatedTextBoxIdRef,
    setEditingTextBoxId,
    setMenuOpen,
    setSelectedTextBoxId,
    updateTextBoxes,
  ]);

  const commitTextBoxEditing = useCallback((boxId: string, options?: { deleteIfEmpty?: boolean }) => {
    const currentTextBoxes = textBoxesRef.current;
    const target = currentTextBoxes.find((item) => item.id === boxId);
    if (!target) {
      if (recentlyCreatedTextBoxIdRef.current === boxId) {
        recentlyCreatedTextBoxIdRef.current = null;
      }
      return { deleted: false, empty: true };
    }
    const editor = getAnnotationEditingBox(layerRef.current, boxId);
    const fallbackHtml = normalizeStoredRichHtml(target.html, target.content);
    const html = sanitizeRichTextHtml(editor?.innerHTML ?? fallbackHtml);
    const content = richHtmlToPlainText(html || fallbackHtml);
    const empty = content.trim().length === 0;
    if (options?.deleteIfEmpty && empty) {
      deleteTextBox(boxId);
      return { deleted: true, empty: true };
    }
    const nextHtml = html || plainTextToRichHtml(content);
    updateTextBoxes((current) =>
      current.map((item) =>
        item.id === boxId ? { ...item, content, html: nextHtml } : item,
      ),
    );
    if (recentlyCreatedTextBoxIdRef.current === boxId) {
      recentlyCreatedTextBoxIdRef.current = null;
    }
    return { deleted: false, empty };
  }, [deleteTextBox, layerRef, recentlyCreatedTextBoxIdRef, textBoxesRef, updateTextBoxes]);

  return {
    updateTextBoxes,
    deleteTextBox,
    commitTextBoxEditing,
  };
}
