const MIN_ANNOTATION_DISPLAY_SCALE = 0.35;
const MAX_ANNOTATION_DISPLAY_SCALE = 2.4;

export function clampAnnotationDisplayScale(scale: number | undefined): number {
  if (!Number.isFinite(scale) || !scale) {
    return 1;
  }
  return Math.max(MIN_ANNOTATION_DISPLAY_SCALE, Math.min(MAX_ANNOTATION_DISPLAY_SCALE, scale));
}

export type TextBoxDisplayMetrics = { padding: number; lineHeight: number };

export function resolveTextBoxDisplayMetrics(scale: number): TextBoxDisplayMetrics {
  return {
    padding: Math.max(2, 6 * scale),
    lineHeight: Math.max(12, 20 * scale),
  };
}

export function resolveAnnotationDisplayScale(input: {
  layerWidth: number;
  fallbackScale?: number;
}): number {
  const measuredScale = input.layerWidth > 0 ? input.layerWidth / 1000 : input.fallbackScale;
  return clampAnnotationDisplayScale(measuredScale);
}

export function resolveScaledRichTextHtml(html: string, scale: number): string {
  if (typeof document === "undefined" || Math.abs(scale - 1) < 0.01) {
    return html;
  }
  const root = document.createElement("div");
  root.innerHTML = html;
  for (const element of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
    const rawSize = element.style.fontSize.trim();
    if (!rawSize) {
      continue;
    }
    const match = rawSize.match(/^([0-9]*\.?[0-9]+)px$/i);
    if (!match) {
      continue;
    }
    const size = Number(match[1]);
    if (!Number.isFinite(size)) {
      continue;
    }
    element.style.fontSize = `${Math.max(1, size * scale)}px`;
  }
  return root.innerHTML;
}
