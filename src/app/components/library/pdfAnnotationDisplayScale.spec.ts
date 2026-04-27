// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { resolveAnnotationDisplayScale, resolveScaledRichTextHtml } from "./pdfAnnotationDisplayScale";

describe("pdf annotation display scale", () => {
  it("derives display scale from the measured layer width", () => {
    expect(resolveAnnotationDisplayScale({ layerWidth: 420, fallbackScale: 1 })).toBeCloseTo(0.42);
  });

  it("scales inline rich text font sizes for display without changing non-px declarations", () => {
    const html = '<p><span style="font-size: 20px; color: #1d4ed8">Test</span><span style="font-size: 1em">Keep</span></p>';
    const scaled = resolveScaledRichTextHtml(html, 0.5);
    expect(scaled).toContain("font-size: 10px");
    expect(scaled).toContain("font-size: 1em");
  });
});
