// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LibraryPdfDownloadToast } from "./LibraryPdfDownloadStatus";

describe("LibraryPdfDownloadToast", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows downloaded bytes without a fake percentage bar when total size is unknown", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <LibraryPdfDownloadToast
          visible
          phase="downloading"
          downloadedBytes={2048}
          totalBytes={null}
          t={(key) => String(key)}
        />,
      );
    });

    expect(container.textContent).toContain("library.viewer.downloadingPdf");
    expect(container.textContent).toContain("library.viewer.downloadedBytes 2.0 KB");
    expect(container.querySelector("[style*='width:']")).toBeNull();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
