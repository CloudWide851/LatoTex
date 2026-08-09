// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { resolveAnnotationDisplayScale, resolveScaledRichTextHtml } from "./pdfAnnotationDisplayScale";
import { readPersistedCspStyle } from "../../../shared/ui/cspStyle";

describe("pdf annotation display scale", () => {
  it("derives display scale from the measured layer width", () => {
    expect(resolveAnnotationDisplayScale({ layerWidth: 420, fallbackScale: 1 })).toBeCloseTo(0.42);
  });

  it("scales inline rich text font sizes for display without changing non-px declarations", () => {
    const html = '<p><span style="font-size: 20px; color: #1d4ed8">Test</span><span style="font-size: 1em">Keep</span></p>';
    const scaled = resolveScaledRichTextHtml(html, 0.5);
    const root = document.createElement("div");
    root.innerHTML = scaled;
    const spans = root.querySelectorAll<HTMLElement>("span");
    expect(Array.from(spans).every((span) => !span.hasAttribute("style"))).toBe(true);
    expect(new Map(readPersistedCspStyle(spans[0])).get("font-size")).toBe("10px");
    expect(new Map(readPersistedCspStyle(spans[1])).get("font-size")).toBe("1em");
  });
});
