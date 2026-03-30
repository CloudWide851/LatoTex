import { describe, expect, it } from "vitest";
import { editorTabOverflowConstants, resolveEditorTabOverflow } from "./editorTabOverflow";

describe("editorTabOverflow", () => {
  const items = [
    { id: "a", width: 72 },
    { id: "b", width: 84 },
    { id: "c", width: 96 },
    { id: "d", width: 88 },
    { id: "e", width: 76 },
  ];

  it("keeps the active tab visible and expands around it when width is limited", () => {
    const result = resolveEditorTabOverflow(items, "c", 260, {
      gap: editorTabOverflowConstants.DEFAULT_TAB_GAP,
      overflowButtonWidth: editorTabOverflowConstants.DEFAULT_OVERFLOW_BUTTON_WIDTH,
    });

    expect(result.visibleIds).toEqual(["b", "c"]);
    expect(result.hiddenIds).toEqual(["a", "d", "e"]);
    expect(result.hasOverflow).toBe(true);
  });

  it("keeps a right-edge active tab visible and hides older left tabs first", () => {
    const result = resolveEditorTabOverflow(items, "e", 248, {
      gap: editorTabOverflowConstants.DEFAULT_TAB_GAP,
      overflowButtonWidth: editorTabOverflowConstants.DEFAULT_OVERFLOW_BUTTON_WIDTH,
    });

    expect(result.visibleIds).toEqual(["d", "e"]);
    expect(result.hiddenIds).toEqual(["a", "b", "c"]);
  });

  it("shows all tabs when there is enough width", () => {
    const result = resolveEditorTabOverflow(items, "c", 520);

    expect(result.visibleIds).toEqual(["a", "b", "c", "d", "e"]);
    expect(result.hiddenIds).toEqual([]);
    expect(result.hasOverflow).toBe(false);
  });
});
