import type { MouseEvent as ReactMouseEvent } from "react";
import type { AnnotationTextBox } from "./annotationModel";

type PdfTextBoxTransformHandlesProps = {
  box: AnnotationTextBox;
  t: (key: any) => string;
  onStartTransform: (mode: "move" | "resize", event: ReactMouseEvent<HTMLButtonElement>, box: AnnotationTextBox) => void;
};

function stopTextboxHandleEvent(event: ReactMouseEvent<HTMLButtonElement>) {
  event.preventDefault();
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
        className="absolute inset-x-3 -top-6 flex h-5 items-center justify-center rounded-md border border-emerald-300 bg-white/95 text-[10px] font-medium text-emerald-700 shadow-sm backdrop-blur"
        style={{ cursor: "move" }}
        aria-label={t("library.viewer.textboxMove")}
        title={t("library.viewer.textboxMove")}
        onClick={stopTextboxHandleEvent}
        onMouseDown={(event) => {
          stopTextboxHandleEvent(event);
          onStartTransform("move", event, box);
        }}
      >
        {t("library.viewer.textboxMove")}
      </button>
      <button
        type="button"
        data-textbox-resize-handle="true"
        data-annotation-ignore-lens="true"
        className="absolute -bottom-2 -right-2 flex h-5 w-5 items-center justify-center rounded-md border border-emerald-300 bg-white/95 text-xs font-semibold text-emerald-700 shadow-sm backdrop-blur"
        style={{ cursor: "nwse-resize" }}
        aria-label={t("library.viewer.textboxResize")}
        title={t("library.viewer.textboxResize")}
        onClick={stopTextboxHandleEvent}
        onMouseDown={(event) => {
          stopTextboxHandleEvent(event);
          onStartTransform("resize", event, box);
        }}
      >
        <>
          <span className="sr-only">{t("library.viewer.textboxResize")}</span>
          <span aria-hidden="true">+</span>
        </>
      </button>
    </>
  );
}
