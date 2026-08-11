import { describe, expect, it } from "vitest";
import {
  fromLibraryWorkspacePath,
  isSameLibraryPath,
  toLibraryWorkspacePath,
} from "./libraryPath";

describe("libraryPath", () => {
  it("does not duplicate the paper-library workspace prefix", () => {
    expect(toLibraryWorkspacePath("demo.bib")).toBe(".latotex/papers/demo.bib");
    expect(toLibraryWorkspacePath(".latotex/papers/demo.bib")).toBe(".latotex/papers/demo.bib");
  });

  it("normalizes and removes the papers prefix for UI selection", () => {
    expect(fromLibraryWorkspacePath(".latotex\\papers\\demo.bib")).toBe("demo.bib");
    expect(fromLibraryWorkspacePath("notes/demo.md")).toBeNull();
    expect(isSameLibraryPath("demo.pdf", ".latotex/papers/demo.pdf")).toBe(true);
  });
});
