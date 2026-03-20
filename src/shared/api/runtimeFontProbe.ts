import { invoke } from "@tauri-apps/api/core";

export type RuntimeSystemFontProbeResult = {
  requestedFonts: string[];
  matchedFonts: string[];
  missingFonts: string[];
  installedCount: number;
  source: string;
  diagnosticCode?: string | null;
};

export function runtimeSystemFontProbe(fontFamilies: string[]): Promise<RuntimeSystemFontProbeResult> {
  return invoke<RuntimeSystemFontProbeResult>("runtime_system_font_probe", {
    input: {
      fontFamilies,
    },
  });
}