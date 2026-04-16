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
        className="absolute inset-x-3 -top-2 h-4 rounded-md bg-transparent opacity-0"
        style={{ cursor: "move" }}
        aria-label={t("library.viewer.textboxMove")}
        title={t("library.viewer.textboxMove")}
        onClick={stopTextboxHandleEvent}
        onMouseDown={(event) => {
          stopTextboxHandleEvent(event);
          onStartTransform("move", event, box);
        }}
      />
      <button
        type="button"
        data-textbox-resize-handle="true"
        data-annotation-ignore-lens="true"
        className="absolute -bottom-2 -right-2 h-5 w-5 rounded-md bg-transparent opacity-0"
        style={{ cursor: "nwse-resize" }}
        aria-label={t("library.viewer.textboxResize")}
        title={t("library.viewer.textboxResize")}
        onClick={stopTextboxHandleEvent}
        onMouseDown={(event) => {
          stopTextboxHandleEvent(event);
          onStartTransform("resize", event, box);
        }}
      />
    </>
  );
}
