// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryDocumentSidebar } from "./LibraryDocumentSidebar";

describe("LibraryDocumentSidebar", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("shows a stable empty-excerpt message when paper metadata exists without preview text", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <LibraryDocumentSidebar
          citation={{
            sourcePath: "library/demo.bib",
            bibPath: "library/demo.bib",
            authors: ["Test Author"],
            urls: ["https://example.com/demo"],
            title: "Demo Paper",
          }}
          activeLink="https://example.com/demo"
          linkError={null}
          copyState={false}
          paperPreview={{
            title: "Demo Paper",
            detectedLanguage: "en",
            extractionEngine: "pdfmathtranslate.extract.pymupdf",
            pageCount: 8,
            excerpt: "",
          }}
          paperPreviewLoading={false}
          paperPreviewError={null}
          sourcePdfState="ready"
          translatedPdfState="missing"
          pdfDownloadedBytes={null}
          pdfTotalBytes={null}
          translationBusy={false}
          translationDetail=""
          onAnalyzePaper={null}
          onOpenLink={() => undefined}
          onCopyLink={() => undefined}
          t={(key) => String(key)}
        />,
      );
    });

    expect(container.textContent).toContain("library.viewer.paperExcerptUnavailable");
    expect(container.textContent).not.toContain("library.viewer.noBib");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
