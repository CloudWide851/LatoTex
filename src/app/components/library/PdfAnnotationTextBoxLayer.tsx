import type { Dispatch, MutableRefObject, PointerEvent as ReactPointerEvent, SetStateAction } from "react";
import type { AnnotationTextBox } from "./annotationModel";
import { resolveScaledRichTextHtml, type TextBoxDisplayMetrics } from "./pdfAnnotationDisplayScale";
import { focusAnnotationEditingBox } from "./pdfAnnotationLayerInteraction";
import { bringBoxToFront } from "./pdfAnnotationLayerUtils";
import { PdfTextBoxContextMenu } from "./PdfTextBoxContextMenu";
import {
  isRichTextEmpty,
  normalizeStoredRichHtml,
  richHtmlToPlainText,
  sanitizeRichTextHtml,
} from "./textboxRichText";

type TranslationFn = (key: any) => string;

export function PdfAnnotationTextBoxLayer(props: {
  boxes: AnnotationTextBox[];
  selectedTextBoxId: string | null;
  editingTextBoxId: string | null;
  menuAnchor: { x: number; y: number } | null;
  menuBox: AnnotationTextBox | null;
  dragPreview: { boxId: string; x: number; y: number; w: number; h: number } | null;
  readOnly: boolean;
  canTransformTextBoxes: boolean;
  displayScale: number;
  textBoxDisplayMetrics: TextBoxDisplayMetrics;
  layerRef: MutableRefObject<HTMLDivElement | null>;
  recentlyCreatedTextBoxIdRef: MutableRefObject<string | null>;
  setMenuOpen: Dispatch<SetStateAction<boolean>>;
  setSelectedTextBoxId: Dispatch<SetStateAction<string | null>>;
  setEditingTextBoxId: Dispatch<SetStateAction<string | null>>;
  updateTextBoxes: (updater: (current: AnnotationTextBox[]) => AnnotationTextBox[]) => void;
  commitTextBoxEditing: (boxId: string, options: { deleteIfEmpty: boolean }) => void;
  deleteTextBox: (boxId: string) => void;
  startTextBoxTransform: (
    mode: "move" | "resize",
    event: ReactPointerEvent<HTMLElement>,
    box: AnnotationTextBox,
  ) => void;
  applyTextBoxStyle: (
    boxId: string,
    nextStyle: Partial<AnnotationTextBox["style"]>,
    options?: { preferInline?: boolean },
  ) => boolean;
  t: TranslationFn;
}) {
  const {
    boxes,
    selectedTextBoxId,
    editingTextBoxId,
    menuAnchor,
    menuBox,
    dragPreview,
    readOnly,
    canTransformTextBoxes,
    displayScale,
    textBoxDisplayMetrics,
    layerRef,
    recentlyCreatedTextBoxIdRef,
    setMenuOpen,
    setSelectedTextBoxId,
    setEditingTextBoxId,
    updateTextBoxes,
    commitTextBoxEditing,
    deleteTextBox,
    startTextBoxTransform,
    applyTextBoxStyle,
    t,
  } = props;

  return (
    <>
      {boxes.map((box) => {
        const selected = box.id === selectedTextBoxId;
        const editing = box.id === editingTextBoxId;
        const boxHtml = normalizeStoredRichHtml(box.html, box.content);
        const displayHtml = editing ? boxHtml : resolveScaledRichTextHtml(boxHtml, displayScale);
        const hasContent = !isRichTextEmpty(boxHtml);
        if (!editing && !hasContent) {
          return null;
        }
        return (
          <div
            key={box.id}
            className={`absolute overflow-visible rounded ${selected ? "ring-1 ring-primary-300" : ""}`}
            data-annotation-box="true"
            data-annotation-ignore-lens="true"
            style={{
              left: `${((dragPreview?.boxId === box.id ? dragPreview.x : box.x) / 1000) * 100}%`,
              top: `${((dragPreview?.boxId === box.id ? dragPreview.y : box.y) / 1000) * 100}%`,
              width: `${((dragPreview?.boxId === box.id ? dragPreview.w : box.w) / 1000) * 100}%`,
              height: `${((dragPreview?.boxId === box.id ? dragPreview.h : box.h) / 1000) * 100}%`,
              zIndex: box.z,
              pointerEvents: readOnly ? "none" : "auto",
              borderColor: box.style.borderColor,
              borderStyle: box.style.borderWidth > 0 ? "solid" : "none",
              borderWidth: `${box.style.borderWidth * displayScale}px`,
              backgroundColor: box.style.backgroundColor,
              cursor: editing ? "text" : "default",
            }}
            onMouseDown={(event) => {
              if (readOnly) {
                return;
              }
              if (event.button !== 0) {
                event.stopPropagation();
                return;
              }
              event.stopPropagation();
              setMenuOpen(true);
              setSelectedTextBoxId(box.id);
              updateTextBoxes((current) => bringBoxToFront(current, box.id));
            }}
            onPointerDown={(event) => {
              if (readOnly || editing || event.button !== 0) {
                return;
              }
              const target = event.target as HTMLElement | null;
              if (
                target?.closest("[data-textbox-menu='true']")
                || target?.closest("[data-textbox-resize-handle='true']")
              ) {
                return;
              }
              event.stopPropagation();
              setMenuOpen(true);
              setSelectedTextBoxId(box.id);
              updateTextBoxes((current) => bringBoxToFront(current, box.id));
              startTextBoxTransform("move", event, box);
            }}
            onContextMenu={(event) => {
              if (readOnly) {
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              setSelectedTextBoxId(box.id);
              setMenuOpen(true);
            }}
            onDoubleClick={(event) => {
              if (readOnly) {
                return;
              }
              event.stopPropagation();
              setSelectedTextBoxId(box.id);
              setEditingTextBoxId(box.id);
              setMenuOpen(true);
            }}
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            {editing ? (
              <div
                autoFocus
                contentEditable
                suppressContentEditableWarning
                data-editing-box={box.id}
                data-textbox-content="true"
                data-textbox-editing="true"
                data-annotation-ignore-lens="true"
                className="h-full w-full overflow-auto rounded border-none bg-transparent outline-none"
                style={{
                  color: box.style.textColor,
                  fontSize: `${box.style.fontSize * displayScale}px`,
                  fontFamily: box.style.fontFamily,
                  lineHeight: `${textBoxDisplayMetrics.lineHeight}px`,
                  padding: `${textBoxDisplayMetrics.padding}px`,
                  textAlign: box.style.textAlign,
                  fontWeight: box.style.fontWeight,
                  fontStyle: box.style.fontStyle,
                  textDecoration: box.style.textDecoration,
                  boxShadow:
                    box.style.backgroundColor === "transparent" && box.style.borderWidth === 0
                      ? "inset 0 0 0 1px rgba(34, 197, 94, 0.45)"
                      : undefined,
                }}
                dangerouslySetInnerHTML={{ __html: displayHtml }}
                onClick={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
                onMouseUp={(event) => event.stopPropagation()}
                onBlur={(event) => {
                  const html = sanitizeRichTextHtml((event.currentTarget as HTMLDivElement).innerHTML);
                  const targetContent = richHtmlToPlainText(html || box.html || box.content || "");
                  if (recentlyCreatedTextBoxIdRef.current === box.id && targetContent.trim().length === 0) {
                    recentlyCreatedTextBoxIdRef.current = null;
                    window.requestAnimationFrame(() => {
                      focusAnnotationEditingBox(layerRef.current, box.id);
                    });
                    return;
                  }
                  commitTextBoxEditing(box.id, { deleteIfEmpty: true });
                  setEditingTextBoxId(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    recentlyCreatedTextBoxIdRef.current = null;
                    event.preventDefault();
                    (event.currentTarget as HTMLDivElement).blur();
                    setEditingTextBoxId(null);
                  }
                }}
              />
            ) : (
              <div
                className="h-full overflow-auto whitespace-pre-wrap break-words"
                data-textbox-content="true"
                data-textbox-static="true"
                data-annotation-ignore-lens="true"
                style={{
                  color: box.style.textColor,
                  fontSize: `${box.style.fontSize * displayScale}px`,
                  fontFamily: box.style.fontFamily,
                  lineHeight: `${textBoxDisplayMetrics.lineHeight}px`,
                  padding: `${textBoxDisplayMetrics.padding}px`,
                  textAlign: box.style.textAlign,
                  fontWeight: box.style.fontWeight,
                  fontStyle: box.style.fontStyle,
                  textDecoration: box.style.textDecoration,
                }}
                dangerouslySetInnerHTML={{ __html: displayHtml }}
              />
            )}
            {selected && !editing && canTransformTextBoxes ? (
              <button
                type="button"
                data-textbox-resize-handle="true"
                data-annotation-ignore-lens="true"
                className="absolute bottom-0 right-0 h-5 w-5 cursor-nwse-resize bg-transparent"
                style={{ touchAction: "none" }}
                aria-label={t("library.viewer.textboxResize")}
                title={t("library.viewer.textboxResize")}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  startTextBoxTransform("resize", event, box);
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
              />
            ) : null}
          </div>
        );
      })}
      {menuAnchor && menuBox ? (
        <PdfTextBoxContextMenu
          x={menuAnchor.x}
          y={menuAnchor.y}
          positioning="fixed"
          style={menuBox.style}
          onApplyStyle={(nextStyle, options) => {
            applyTextBoxStyle(menuBox.id, nextStyle, options);
          }}
          onDelete={() => deleteTextBox(menuBox.id)}
          onClose={() => setMenuOpen(false)}
          t={t}
        />
      ) : null}
    </>
  );
}
