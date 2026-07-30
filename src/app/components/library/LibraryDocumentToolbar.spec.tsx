// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryDocumentToolbar } from "./LibraryDocumentToolbar";

const baseProps = {
  selectedPath: "papers/demo.bib",
  documentBusy: false,
  analysisRunning: false,
  translationBusy: false,
  hasTranslated: true,
  translationNotice: null,
  activeLink: null,
  copyState: false,
  onViewModeChange: () => undefined,
  onOpenPdf: () => undefined,
  onAnalyzePaper: () => undefined,
  onCompareAction: () => undefined,
  onRetranslate: () => undefined,
  onOpenLink: () => undefined,
  onCopyLink: () => undefined,
  t: (key: any) => String(key),
};

describe("LibraryDocumentToolbar compare sync control", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows an accessible pressed toggle only in compare mode", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onCompareSyncEnabledChange = vi.fn();
    await act(async () => root.render(
      <LibraryDocumentToolbar
        {...baseProps}
        viewMode="compare"
        compareSyncEnabled
        onCompareSyncEnabledChange={onCompareSyncEnabledChange}
      />,
    ));

    const toggle = container.querySelector(
      "button[aria-label='library.viewer.disableSyncScroll']",
    );
    expect(toggle?.getAttribute("aria-pressed")).toBe("true");
    await act(async () => toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onCompareSyncEnabledChange).toHaveBeenCalledWith(false);

    await act(async () => root.render(
      <LibraryDocumentToolbar
        {...baseProps}
        viewMode="pdf"
        compareSyncEnabled
        onCompareSyncEnabledChange={onCompareSyncEnabledChange}
      />,
    ));
    expect(container.querySelector("button[aria-pressed]")).toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });
});
