import type { CSSProperties } from "react";
import type { AppSettings } from "../../shared/types/app";
import { ACCENT_COLORS, THEME_PRESETS, cropBackgroundStyle } from "../components/AppContainerTheme";

export const DEFAULT_GLASS_OPACITY = 0.86;
export const DEFAULT_GLASS_BLUR_PX = 14;
export const DEFAULT_PANEL_RADIUS_PX = 10;

type UiPrefs = NonNullable<AppSettings["uiPrefs"]>;

export type ResolvedAppAppearance = {
  backgroundPath: string;
  backgroundBlurPx: number;
  fontScale: number;
  motionClass: string;
  borderClass: string;
  style: CSSProperties & Record<string, string | number | undefined>;
};

function clampNumber(value: unknown, minimum: number, maximum: number, fallback: number): number {
  const numeric = Number(value ?? fallback);
  return Number.isFinite(numeric) ? Math.max(minimum, Math.min(maximum, numeric)) : fallback;
}

export function resolveBackgroundPath(prefs?: UiPrefs): string {
  const availablePaths = Array.from(
    new Set(
      (Array.isArray(prefs?.backgroundImagePaths) ? prefs.backgroundImagePaths : [])
        .map((item) => String(item ?? "").trim())
        .filter(Boolean),
    ),
  );
  const selectedPath = String(prefs?.backgroundImagePath ?? "").trim();
  return selectedPath && availablePaths.includes(selectedPath) ? selectedPath : "";
}

export function resolveAppAppearance(
  prefs?: UiPrefs,
  backgroundUrl = "",
): ResolvedAppAppearance {
  const backgroundPath = resolveBackgroundPath(prefs);
  const backgroundCropStyle = backgroundPath
    ? cropBackgroundStyle(backgroundPath, prefs?.backgroundCropByPath)
    : null;
  const backgroundBlurPx = clampNumber(prefs?.backgroundBlurPx, 4, 32, 18);
  const themePreset = THEME_PRESETS[String(prefs?.themePreset ?? "default")] ?? THEME_PRESETS.default;
  const accentChoice = String(prefs?.accentColor ?? "emerald");
  const accentColor = accentChoice === "custom"
    ? String(prefs?.accentCustomColor || ACCENT_COLORS.emerald)
    : ACCENT_COLORS[accentChoice] ?? themePreset.accent;
  const hasCustomScrollbarColors = Boolean(
    String(prefs?.scrollbarThumbColor ?? "").trim()
    || String(prefs?.scrollbarTrackColor ?? "").trim(),
  );
  const scrollbarColorMode = String(
    prefs?.scrollbarColorMode ?? (hasCustomScrollbarColors ? "custom" : "accent"),
  );
  const scrollbarThumbColor = scrollbarColorMode === "custom"
    ? String(prefs?.scrollbarThumbColor || accentColor)
    : accentColor;
  const scrollbarTrackColor = scrollbarColorMode === "custom"
    ? String(prefs?.scrollbarTrackColor || "")
    : "";
  const fontScale = clampNumber(prefs?.fontScale, 0.85, 1.25, 1);
  const editorBackgroundColor = String(prefs?.editorBackgroundColor ?? "").trim();
  const customEditorBackground = /^#[0-9a-f]{6}$/i.test(editorBackgroundColor)
    ? editorBackgroundColor
    : "";

  const style = {
    ...(backgroundUrl
      ? {
          backgroundImage: `url("${backgroundUrl}")`,
          backgroundSize: backgroundCropStyle?.backgroundSize ?? "cover",
          backgroundPosition: backgroundCropStyle?.backgroundPosition ?? "center",
          backgroundRepeat: "no-repeat",
          ["--wallpaper-blur" as string]: `${backgroundBlurPx}px`,
        }
      : {}),
    ["--app-accent" as string]: accentColor,
    ["--app-theme-surface" as string]: themePreset.surface,
    ["--control-primary-top" as string]: accentColor,
    ["--control-primary-bottom" as string]: accentColor,
    ["--control-primary-top-hover" as string]: accentColor,
    ["--control-primary-bottom-hover" as string]: accentColor,
    ["--control-primary-border" as string]: accentColor,
    ["--library-scrollbar-thumb" as string]: scrollbarThumbColor,
    ["--library-scrollbar-thumb-hover" as string]: scrollbarColorMode === "custom"
      ? scrollbarThumbColor
      : accentColor,
    ["--library-scrollbar-track" as string]: scrollbarTrackColor || themePreset.scrollbarTrack,
    ["--app-scrollbar-size" as string]: `${clampNumber(prefs?.scrollbarWidthPx, 8, 18, 14)}px`,
    ["--app-glass-opacity" as string]: String(
      clampNumber(prefs?.glassOpacity, 0.55, 1, DEFAULT_GLASS_OPACITY),
    ),
    ["--app-glass-blur" as string]: `${clampNumber(
      prefs?.glassBlurPx,
      0,
      32,
      DEFAULT_GLASS_BLUR_PX,
    )}px`,
    ["--app-panel-radius" as string]: `${clampNumber(
      prefs?.panelRadiusPx,
      4,
      14,
      DEFAULT_PANEL_RADIUS_PX,
    )}px`,
    ["--app-pdf-page-gap" as string]: `${clampNumber(prefs?.pdfPageGapPx, 4, 28, 12)}px`,
    ["--app-font-scale" as string]: String(fontScale),
    ["--app-log-font-size" as string]: `${clampNumber(prefs?.logFontSizePx, 10, 16, 12)}px`,
    ...(customEditorBackground ? { ["--editor-paper-bg" as string]: customEditorBackground } : {}),
    backgroundColor: themePreset.background,
  } as CSSProperties & Record<string, string | number | undefined>;

  return {
    backgroundPath,
    backgroundBlurPx,
    fontScale,
    motionClass: `app-motion-${prefs?.motionLevel ?? "full"}`,
    borderClass: `app-border-${prefs?.panelBorderContrast ?? "normal"}`,
    style,
  };
}
