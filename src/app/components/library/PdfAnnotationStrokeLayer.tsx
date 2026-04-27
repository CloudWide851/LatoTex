import type { AnnotationPoint, AnnotationStroke } from "./annotationModel";
import { hexToRgba } from "./annotationPalette";

export function PdfAnnotationStrokeLayer(props: {
  pageStrokes: AnnotationStroke[];
  draftStroke: AnnotationPoint[] | null;
  highlightColor: string;
  highlightWidth: number;
  highlightOpacity: number;
}) {
  const { pageStrokes, draftStroke, highlightColor, highlightWidth, highlightOpacity } = props;
  return (
    <svg
      className="pointer-events-none absolute inset-0 z-10 h-full w-full"
      viewBox="0 0 1000 1000"
      preserveAspectRatio="none"
    >
      {pageStrokes.map((stroke) => (
        <polyline
          key={stroke.id}
          points={stroke.points.map((point) => `${point.x},${point.y}`).join(" ")}
          fill="none"
          stroke={hexToRgba(stroke.style?.color ?? "#facc15", stroke.style?.opacity ?? 0.65)}
          strokeWidth={stroke.style?.width ?? 16}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {draftStroke && draftStroke.length > 1 ? (
        <polyline
          points={draftStroke.map((point) => `${point.x},${point.y}`).join(" ")}
          fill="none"
          stroke={hexToRgba(highlightColor, Math.min(1, highlightOpacity + 0.07))}
          strokeWidth={highlightWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
    </svg>
  );
}
