import { describe, expect, it } from "vitest";
import {
  DEFAULT_GLASS_BLUR_PX,
  DEFAULT_GLASS_OPACITY,
  DEFAULT_PANEL_RADIUS_PX,
  resolveAppAppearance,
  resolveBackgroundPath,
} from "./appAppearance";

describe("resolveAppAppearance", () => {
  it("uses the restrained glass defaults for a new profile", () => {
    const result = resolveAppAppearance();

    expect(result.style["--app-glass-opacity"]).toBe(String(DEFAULT_GLASS_OPACITY));
    expect(result.style["--app-glass-blur"]).toBe(`${DEFAULT_GLASS_BLUR_PX}px`);
    expect(result.style["--app-panel-radius"]).toBe(`${DEFAULT_PANEL_RADIUS_PX}px`);
  });

  it("keeps persisted appearance values authoritative and clamps unsafe input", () => {
    const result = resolveAppAppearance({
      glassOpacity: 0.72,
      glassBlurPx: 19,
      panelRadiusPx: 12,
      fontScale: 99,
    });

    expect(result.style["--app-glass-opacity"]).toBe("0.72");
    expect(result.style["--app-glass-blur"]).toBe("19px");
    expect(result.style["--app-panel-radius"]).toBe("12px");
    expect(result.fontScale).toBe(1.25);
  });

  it("keeps custom scrollbar colors independent from the accent", () => {
    const result = resolveAppAppearance({
      accentColor: "blue",
      scrollbarColorMode: "custom",
      scrollbarThumbColor: "#334455",
      scrollbarTrackColor: "#ddeeff",
    });

    expect(result.style["--library-scrollbar-thumb"]).toBe("#334455");
    expect(result.style["--library-scrollbar-thumb-hover"]).toBe("#334455");
    expect(result.style["--library-scrollbar-track"]).toBe("#ddeeff");
  });
});

describe("resolveBackgroundPath", () => {
  it("only accepts a selected wallpaper that remains in the saved list", () => {
    expect(resolveBackgroundPath({
      backgroundImagePath: "kept.png",
      backgroundImagePaths: ["kept.png", "kept.png"],
    })).toBe("kept.png");
    expect(resolveBackgroundPath({
      backgroundImagePath: "removed.png",
      backgroundImagePaths: ["kept.png"],
    })).toBe("");
  });
});
