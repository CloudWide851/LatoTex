import { describe, expect, it } from "vitest";
import { isPersistableLibraryBibLayout, normalizeLibraryBibLayout } from "./libraryBibLayout";

describe("libraryBibLayout", () => {
  it("falls back when a persisted layout would hide a Bib or metadata pane", () => {
    expect(normalizeLibraryBibLayout([95, 5])).toEqual([54, 46]);
    expect(normalizeLibraryBibLayout([0, 0])).toEqual([54, 46]);
  });

  it("accepts valid two-pane layouts and rejects invalid persistence input", () => {
    expect(normalizeLibraryBibLayout([60, 40])).toEqual([60, 40]);
    expect(isPersistableLibraryBibLayout([24, 76])).toBe(true);
    expect(isPersistableLibraryBibLayout([98, 2])).toBe(false);
  });
});
