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

  it("keeps embedded DOCX image data URLs while removing unsafe image attributes", () => {
    const html = sanitizeDocxHtml('<p><img data-docx-embedded="rId1" data-docx-media="word/media/image1.png" src="data:image/png;base64,AAAA" onerror="x" /><img src="data:text/html;base64,PHNjcmlwdA==" /></p>');
    expect(html).toContain('data-docx-embedded="rId1"');
    expect(html).toContain("data:image/png;base64,AAAA");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("data:text/html");
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

  it("does not replace resource triggers outside the active editor root", () => {
    const editor = document.createElement("div");
    const outside = document.createElement("div");
    editor.contentEditable = "true";
    outside.contentEditable = "true";
    outside.textContent = "@@ fig";
    document.body.append(editor, outside);

    const textNode = outside.firstChild as Text;
    const range = document.createRange();
    range.setStart(textNode, "@@ fig".length);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(replaceResourceTriggerWithHtml('<img data-docx-resource="fig.png" src="blob:x" alt="fig" />', editor)).toBe(false);
    expect(outside.textContent).toBe("@@ fig");
    editor.remove();
    outside.remove();
  });

  it("places the caret after the inserted resource", () => {
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.textContent = "@@ fig";
    document.body.appendChild(editor);
    const textNode = editor.firstChild as Text;
    const range = document.createRange();
    range.setStart(textNode, "@@ fig".length);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(replaceResourceTriggerWithHtml('<img data-docx-resource="fig.png" src="blob:x" alt="fig" />', editor)).toBe(true);
    expect(selection?.rangeCount).toBe(1);
    expect(selection?.getRangeAt(0).collapsed).toBe(true);
    expect(selection?.getRangeAt(0).startContainer).toBe(editor);
    const imageIndex = Array.from(editor.childNodes).indexOf(editor.querySelector("img") as HTMLImageElement);
    expect(selection?.getRangeAt(0).startOffset).toBeGreaterThan(imageIndex);
    editor.remove();
  });
});
