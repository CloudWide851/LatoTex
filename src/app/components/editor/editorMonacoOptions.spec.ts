import { describe, expect, it } from "vitest";
import { createWorkspaceEditorMonacoOptions } from "./editorMonacoOptions";

describe("editorMonacoOptions", () => {
  it("keeps line numbers and gutter chrome enabled for workspace editing", () => {
    const options = createWorkspaceEditorMonacoOptions();

    expect(options.lineNumbers).toBe("on");
    expect(options.lineNumbersMinChars).toBe(3);
    expect(options.lineDecorationsWidth).toBe(4);
    expect(options.glyphMargin).toBe(false);
    expect(options.folding).toBe(true);
    expect(options.renderValidationDecorations).toBe("on");
    expect(options.renderLineHighlightGutter).toBe("all");
  });
});
