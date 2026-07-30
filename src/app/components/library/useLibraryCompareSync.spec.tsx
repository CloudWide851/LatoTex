// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultLibraryViewerSession, type LibraryViewerSession } from "./libraryViewerSessionStore";
import { useLibraryCompareSync } from "./useLibraryCompareSync";

function CompareSyncProbe() {
  const [session, setSessionState] = useState<LibraryViewerSession>(() => ({
    ...defaultLibraryViewerSession("compare"),
    compareSourceZoom: 1.3,
    compareTranslatedZoom: 0.9,
  }));
  const setSession = (
    next:
      | Partial<LibraryViewerSession>
      | ((current: LibraryViewerSession) => LibraryViewerSession),
  ) => {
    setSessionState((current) => typeof next === "function"
      ? next(current)
      : { ...current, ...next });
  };
  const sync = useLibraryCompareSync({
    projectId: "project",
    selectedPath: "papers/demo.bib",
    session,
    setSession,
  });

  return (
    <div
      data-testid="state"
      data-enabled={String(sync.compareSyncEnabled)}
      data-source-zoom={String(session.compareSourceZoom)}
      data-translated-zoom={String(session.compareTranslatedZoom)}
      data-message={JSON.stringify(sync.compareSyncGroupRef.current?.lastMessage ?? null)}
    >
      <button type="button" onClick={() => sync.setCompareSyncEnabled(false)}>disable</button>
      <button
        type="button"
        onClick={() => {
          sync.setCompareTranslatedScrollAnchor({
            page: 6,
            pageFocusRatio: 0.4,
            absoluteRatio: 0.7,
          });
          sync.markComparePaneActive("translated");
        }}
      >
        scroll translated
      </button>
      <button type="button" onClick={() => sync.setCompareSyncEnabled(true)}>enable</button>
    </div>
  );
}

describe("useLibraryCompareSync", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("realigns once from the latest active pane without changing independent zoom", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<CompareSyncProbe />));

    const click = async (label: string) => {
      const button = Array.from(container.querySelectorAll("button"))
        .find((item) => item.textContent === label);
      await act(async () => button?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    };

    await click("disable");
    await click("scroll translated");
    await click("enable");

    const state = container.querySelector("[data-testid='state']");
    const message = JSON.parse(state?.getAttribute("data-message") ?? "null");
    expect(state?.getAttribute("data-enabled")).toBe("true");
    expect(message.sourceId).toBe("translated");
    expect(message.anchor).toEqual({
      page: 6,
      pageFocusRatio: 0.4,
      absoluteRatio: 0.7,
    });
    expect(state?.getAttribute("data-source-zoom")).toBe("1.3");
    expect(state?.getAttribute("data-translated-zoom")).toBe("0.9");

    await act(async () => root.unmount());
    container.remove();
  });
});
