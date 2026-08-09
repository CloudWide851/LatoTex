// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyStyleToRichTextSelection,
  captureRichTextSelection,
  restoreRichTextSelection,
  sanitizeRichTextHtml,
} from "./textboxRichText";
import { readPersistedCspStyle } from "../../../shared/ui/cspStyle";

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
    const wrapper = editor.querySelector("span");
    expect(wrapper).not.toBeNull();
    expect(wrapper?.hasAttribute("style")).toBe(false);
    expect(new Map(readPersistedCspStyle(wrapper as HTMLElement))).toEqual(new Map([
      ["color", "#1d4ed8"],
      ["font-weight", "bold"],
    ]));
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

  it("migrates legacy inline formatting and removes active content", () => {
    const sanitized = sanitizeRichTextHtml(
      '<span data-latotex-style="borrowed-rule" style="font-size: 18px; color: #1d4ed8; background: url(javascript:alert(1))" onclick="alert(1)">Safe</span><script>alert(2)</script>',
    );
    const root = document.createElement("div");
    root.innerHTML = sanitized;
    const span = root.querySelector("span") as HTMLElement;
    expect(span.hasAttribute("style")).toBe(false);
    expect(span.hasAttribute("onclick")).toBe(false);
    expect(span.getAttribute("data-latotex-style")).not.toBe("borrowed-rule");
    expect(root.querySelector("script")).toBeNull();
    expect(new Map(readPersistedCspStyle(span))).toEqual(new Map([
      ["color", "#1d4ed8"],
      ["font-size", "18px"],
    ]));
  });
});
