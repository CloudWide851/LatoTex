import { describe, expect, it } from "vitest";
import { createWorkspaceEditorMonacoOptions } from "./editorMonacoOptions";

describe("editorMonacoOptions", () => {
  it("keeps line numbers and gutter chrome enabled for workspace editing", () => {
    const options = createWorkspaceEditorMonacoOptions();

    expect(options.lineNumbers).toBe("on");
    expect(options.lineNumbersMinChars).toBe(6);
    expect(options.lineDecorationsWidth).toBe(8);
    expect(options.glyphMargin).toBe(false);
    expect(options.folding).toBe(true);
    expect(options.renderValidationDecorations).toBe("on");
    expect(options.renderLineHighlightGutter).toBe("all");
  });

  it("scales editor font metrics from the interface font scale", () => {
    const options = createWorkspaceEditorMonacoOptions(null, 1.25);

    expect(options.fontSize).toBe(18);
    expect(options.lineHeight).toBe(28);
    expect(options.letterSpacing).toBe(0);
  });
});
