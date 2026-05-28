// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { replaceResourceTriggerWithHtml, sanitizeDocxHtml } from "./docxUtils";

describe("docxUtils", () => {
  it("keeps safe word-like inline tags and page break markers", () => {
    const html = sanitizeDocxHtml('<p data-docx-page-break="true"><script>x</script><s>A</s><sub>B</sub><sup>C</sup></p>');
    expect(html).toContain('data-docx-page-break="true"');
    expect(html).toContain("<s>A</s>");
    expect(html).toContain("<sub>B</sub>");
    expect(html).toContain("<sup>C</sup>");
    expect(html).not.toContain("<script>");
  });

  it("replaces the exact resource trigger before inserting resource html", () => {
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.textContent = "Before @@ fig";
    document.body.appendChild(editor);
    const textNode = editor.firstChild as Text;
    const range = document.createRange();
    range.setStart(textNode, "Before @@ fig".length);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(replaceResourceTriggerWithHtml('<img data-docx-resource="fig.png" src="blob:x" alt="fig" />')).toBe(true);
    expect(editor.innerHTML).not.toContain("@@");
    expect(editor.querySelector("img")?.getAttribute("data-docx-resource")).toBe("fig.png");
    editor.remove();
  });
});
