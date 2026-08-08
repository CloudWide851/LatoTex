import type { AppSettings } from "../../shared/types/app";

const ENUM_VALUES = {
  language: new Set(["en-US", "zh-CN", "es-ES", "ja-JP"]),
  theme: new Set(["light", "dark", "system"]),
  themePreset: new Set(["default", "graphite", "paper", "forest", "ocean", "rose", "amber", "highContrast"]),
  interfaceDensity: new Set(["compact", "comfortable", "spacious"]),
  motionLevel: new Set(["full", "reduced", "none"]),
} as const;

const BOOLEAN_KEYS = new Set(["docxAutoSaveEnabled"]);
const NUMBER_RANGES: Record<string, readonly [number, number]> = {
  previewDefaultZoom: [0.25, 4],
  fontScale: [0.8, 1.4],
};

export function applyResearchSettingsPatch(settings: AppSettings, patch: unknown): AppSettings {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new Error("research.ui_command.settings_patch_invalid");
  }
  const envelope = patch as Record<string, unknown>;
  if (Object.keys(envelope).some((key) => key !== "uiPrefs")) {
    throw new Error("research.ui_command.settings_scope_invalid");
  }
  const uiPrefs = envelope.uiPrefs;
  if (!uiPrefs || typeof uiPrefs !== "object" || Array.isArray(uiPrefs)) {
    throw new Error("research.ui_command.settings_patch_invalid");
  }
  const nextPrefs: Record<string, unknown> = { ...(settings.uiPrefs ?? {}) };
  for (const [key, value] of Object.entries(uiPrefs as Record<string, unknown>)) {
    if (key in ENUM_VALUES) {
      const allowed = ENUM_VALUES[key as keyof typeof ENUM_VALUES];
      if (typeof value !== "string" || !allowed.has(value as never)) {
        throw new Error("research.ui_command.settings_value_invalid");
      }
      nextPrefs[key] = value;
      continue;
    }
    if (BOOLEAN_KEYS.has(key)) {
      if (typeof value !== "boolean") {
        throw new Error("research.ui_command.settings_value_invalid");
      }
      nextPrefs[key] = value;
      continue;
    }
    const range = NUMBER_RANGES[key];
    if (range) {
      if (typeof value !== "number" || !Number.isFinite(value) || value < range[0] || value > range[1]) {
        throw new Error("research.ui_command.settings_value_invalid");
      }
      nextPrefs[key] = value;
      continue;
    }
    throw new Error("research.ui_command.settings_key_unsupported");
  }
  return {
    ...settings,
    uiPrefs: nextPrefs as AppSettings["uiPrefs"],
  };
}
