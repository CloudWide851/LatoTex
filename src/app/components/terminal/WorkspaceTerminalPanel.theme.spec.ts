// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { getTerminalSurfaceTheme } from "./terminalSurfaceTheme";

describe("terminal surface theme", () => {
  afterEach(() => {
    delete document.documentElement.dataset.theme;
  });

  it("uses a transparent light surface with dark foreground text", () => {
    document.documentElement.dataset.theme = "light";
    const theme = getTerminalSurfaceTheme();

    expect(theme.background).toBe("#00000000");
    expect(theme.foreground).toBe("#1e293b");
  });

  it("uses a transparent dark surface with light foreground text", () => {
    document.documentElement.dataset.theme = "dark";
    const theme = getTerminalSurfaceTheme();

    expect(theme.background).toBe("#00000000");
    expect(theme.foreground).toBe("#e2e8f0");
  });
});
