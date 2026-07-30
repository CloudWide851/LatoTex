// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  defaultLibraryViewerSession,
  loadLibraryViewerSession,
} from "./libraryViewerSessionStore";

describe("libraryViewerSessionStore compare sync migration", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("enables compare sync for legacy sessions and uses the source pane as leader", () => {
    window.localStorage.setItem(
      "latotex.library.viewer.sessions.project-1",
      JSON.stringify({
        sessions: {
          "papers/demo.bib": {
            ...defaultLibraryViewerSession("compare"),
            compareSyncEnabled: undefined,
            compareSyncLeader: undefined,
          },
        },
      }),
    );

    const session = loadLibraryViewerSession("project-1", "papers/demo.bib", "compare");

    expect(session.compareSyncEnabled).toBe(true);
    expect(session.compareSyncLeader).toBe("source");
  });

  it("preserves an explicit disabled state and validated translated leader", () => {
    const stored = {
      ...defaultLibraryViewerSession("compare"),
      compareSyncEnabled: false,
      compareSyncLeader: "translated",
    };
    window.localStorage.setItem(
      "latotex.library.viewer.sessions.project-2",
      JSON.stringify({ sessions: { "papers/demo.bib": stored } }),
    );

    const session = loadLibraryViewerSession("project-2", "papers/demo.bib", "compare");

    expect(session.compareSyncEnabled).toBe(false);
    expect(session.compareSyncLeader).toBe("translated");
  });
});
