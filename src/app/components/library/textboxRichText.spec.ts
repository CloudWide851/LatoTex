// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyStyleToRichTextSelection,
  captureRichTextSelection,
  restoreRichTextSelection,
} from "./textboxRichText";

describe("textboxRichText selection helpers", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("captures, restores, and formats the active selection inside an editor", () => {
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.innerHTML = "Hello world";
    document.body.appendChild(editor);

    const textNode = editor.firstChild as Text;
    const range = document.createRange();
    range.setStart(textNode, 6);
    range.setEnd(textNode, 11);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const snapshot = captureRichTextSelection(editor);
    expect(snapshot).not.toBeNull();

    selection?.removeAllRanges();
    const restored = restoreRichTextSelection(editor, snapshot);
    expect(restored).not.toBeNull();

    const formatted = applyStyleToRichTextSelection(editor, {
      fontWeight: "bold",
      textColor: "#1d4ed8",
    });
    expect(formatted).not.toBeNull();
    expect(editor.innerHTML).toContain("<span");
    expect(editor.innerHTML).toContain("font-weight: bold");
    expect(editor.innerHTML).toContain("color: rgb(29, 78, 216)");
  });

  it("ignores collapsed selections", () => {
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.innerHTML = "Hello world";
    document.body.appendChild(editor);

    const textNode = editor.firstChild as Text;
    const range = document.createRange();
    range.setStart(textNode, 5);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(captureRichTextSelection(editor)).toBeNull();
    expect(applyStyleToRichTextSelection(editor, { fontWeight: "bold" })).toBeNull();
  });
});
