import { describe, expect, it } from "vitest";
import { reorderTerminalTabs } from "./terminalTabOrder";
import type { TerminalTab } from "./terminalTypes";

function tab(id: string): TerminalTab {
  return {
    id,
    title: id,
    relativePath: null,
    sessionId: null,
    cwd: "",
    venvPath: null,
    envSource: null,
    status: "running",
    cursor: 0,
    buffer: "",
    error: null,
  };
}

describe("reorderTerminalTabs", () => {
  it("moves a dragged tab across the hovered target", () => {
    expect(reorderTerminalTabs([tab("one"), tab("two"), tab("three")], "one", "two").map((item) => item.id))
      .toEqual(["two", "one", "three"]);
    expect(reorderTerminalTabs([tab("one"), tab("two"), tab("three")], "three", "one").map((item) => item.id))
      .toEqual(["three", "one", "two"]);
  });
});
