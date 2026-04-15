import type { MouseEvent as ReactMouseEvent } from "react";
import type { AnnotationTextBox } from "./annotationModel";

type PdfTextBoxTransformHandlesProps = {
  box: AnnotationTextBox;
  t: (key: any) => string;
  onStartTransform: (mode: "move" | "resize", event: ReactMouseEvent<HTMLButtonElement>, box: AnnotationTextBox) => void;
};

function stopTextboxHandleEvent(event: ReactMouseEvent<HTMLButtonElement>) {
  event.stopPropagation();
}

export function PdfTextBoxTransformHandles(props: PdfTextBoxTransformHandlesProps) {
  const { box, t, onStartTransform } = props;

  return (
    <>
      <button
        type="button"
        data-textbox-move-handle="true"
        data-annotation-ignore-lens="true"
        className="absolute -left-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-emerald-500/80 bg-white text-[10px] font-semibold text-emerald-700 shadow-sm"
        style={{ cursor: "move" }}
        aria-label={t("library.viewer.textboxMove")}
        title={t("library.viewer.textboxMove")}
        onClick={stopTextboxHandleEvent}
        onMouseUp={stopTextboxHandleEvent}
        onMouseDown={(event) => {
          stopTextboxHandleEvent(event);
          onStartTransform("move", event, box);
        }}
      >
        <span aria-hidden="true">::</span>
      </button>
      <button
        type="button"
        data-textbox-resize-handle="true"
        data-annotation-ignore-lens="true"
        className="absolute -bottom-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-emerald-400 bg-white shadow-sm"
        style={{ cursor: "nwse-resize" }}
        aria-label={t("library.viewer.textboxResize")}
        title={t("library.viewer.textboxResize")}
        onClick={stopTextboxHandleEvent}
        onMouseUp={stopTextboxHandleEvent}
        onMouseDown={(event) => {
          stopTextboxHandleEvent(event);
          onStartTransform("resize", event, box);
        }}
      >
        <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
      </button>
    </>
  );
}
