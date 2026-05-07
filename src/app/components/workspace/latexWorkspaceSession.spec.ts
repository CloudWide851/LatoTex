import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadLatexWorkspaceSession,
  persistLatexWorkspaceChatSession,
  persistLatexWorkspaceFileSession,
  resolveLatexWorkspaceRestore,
} from "./latexWorkspaceSession";

describe("latexWorkspaceSession", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        clear: () => values.clear(),
        getItem: (key: string) => values.get(key) ?? null,
        removeItem: (key: string) => values.delete(key),
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
  });

  it("restores only paths that still exist in the project tree", () => {
    persistLatexWorkspaceFileSession({
      projectId: "project-1",
      tabs: [{ path: "main.tex" }, { path: "missing.tex" }, { path: "chapters/a.tex" }],
      activePath: "missing.tex",
    });

    const restored = resolveLatexWorkspaceRestore(
      "project-1",
      new Set(["main.tex", "chapters/a.tex"]),
      "main.tex",
    );

    expect(restored.tabPaths).toEqual(["main.tex", "chapters/a.tex"]);
    expect(restored.activePath).toBe("main.tex");
  });

  it("keeps chat state when file tabs are updated", () => {
    persistLatexWorkspaceChatSession({
      projectId: "project-1",
      chatTabOpen: true,
      chatTabActive: true,
    });
    persistLatexWorkspaceFileSession({
      projectId: "project-1",
      tabs: [{ path: "main.tex" }],
      activePath: "main.tex",
    });

    expect(loadLatexWorkspaceSession("project-1")).toMatchObject({
      tabPaths: ["main.tex"],
      activePath: "main.tex",
      chatTabOpen: true,
      chatTabActive: true,
    });
  });

  it("does not restore active chat when the chat tab was closed", () => {
    persistLatexWorkspaceChatSession({
      projectId: "project-1",
      chatTabOpen: false,
      chatTabActive: true,
    });

    expect(loadLatexWorkspaceSession("project-1")).toMatchObject({
      chatTabOpen: false,
      chatTabActive: false,
    });
  });
});
