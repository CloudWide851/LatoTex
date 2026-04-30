import { describe, expect, it } from "vitest";
import { toLibraryWorkspacePath } from "./libraryPath";

describe("libraryPath", () => {
  it("does not duplicate the paper-library workspace prefix", () => {
    expect(toLibraryWorkspacePath("demo.bib")).toBe(".latotex/papers/demo.bib");
    expect(toLibraryWorkspacePath(".latotex/papers/demo.bib")).toBe(".latotex/papers/demo.bib");
  });
});
