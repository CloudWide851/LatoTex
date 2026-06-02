// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FilePreviewPane } from "./FilePreviewPane";

describe("FilePreviewPane", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders standalone HTML markdown content through the sanitized HTML iframe", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <FilePreviewPane
          mode="markdown"
          pdfUrl={null}
          imageUrl={null}
          activeProjectId="project-1"
          markdownContent="<html><body><h1>Preview</h1><script>alert(1)</script></body></html>"
          htmlContent=""
          svgContent=""
          selectedPath="preview.md"
          title="Preview"
          emptyText="Empty"
          pdfZoom={1}
          onPdfZoomChange={() => undefined}
          t={(key) => String(key)}
        />,
      );
    });

    const frame = container.querySelector("iframe");
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute("sandbox")).toBe("");
    expect(frame?.getAttribute("srcdoc")).toContain("<h1>Preview</h1>");
    expect(frame?.getAttribute("srcdoc")).not.toContain("<script>");

    await act(async () => {
      root.unmount();
    });
  });
});
