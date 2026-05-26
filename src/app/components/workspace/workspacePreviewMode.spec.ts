import { describe, expect, it } from "vitest";
import {
  isWorkspaceUnsupportedPreviewPath,
  resolveWorkspacePreviewFlags,
  resolveWorkspacePreviewMode,
} from "./workspacePreviewMode";

function modeFor(path: string | null, overrides: Partial<Parameters<typeof resolveWorkspacePreviewMode>[0]> = {}) {
  const flags = resolveWorkspacePreviewFlags(path);
  return resolveWorkspacePreviewMode({
    flags,
    selectedImagePreviewUrl: null,
    selectedFilePdfUrl: null,
    compiledPdfUrl: null,
    previewSelectedPath: path,
    preferCompiledPreview: false,
    ...overrides,
  });
}

describe("workspacePreviewMode", () => {
  it("keeps ordinary source files out of the right preview pane", () => {
    expect(modeFor("scripts/analyze.py")).toBe("empty");
    expect(isWorkspaceUnsupportedPreviewPath("scripts/analyze.py")).toBe(true);
  });

  it("allows explicit preview types without hijacking the preview for terminal", () => {
    expect(modeFor("paper.md")).toBe("markdown");
    expect(modeFor("figure.svg")).toBe("svg");
    expect(modeFor("figure.png", { selectedImagePreviewUrl: "blob:figure" })).toBe("image");
    expect(modeFor("main.tex", { compiledPdfUrl: "blob:pdf" })).toBe("pdf");
  });

  it("routes DOCX away from text preview without treating it as unsupported", () => {
    expect(resolveWorkspacePreviewFlags("notes/chapter.docx").selectedIsDocx).toBe(true);
    expect(modeFor("notes/chapter.docx")).toBe("empty");
    expect(isWorkspaceUnsupportedPreviewPath("notes/chapter.docx")).toBe(false);
  });
});
