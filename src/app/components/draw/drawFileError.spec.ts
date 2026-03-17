import { describe, expect, it } from "vitest";
import { isMissingFileReadError } from "./drawFileError";

describe("isMissingFileReadError", () => {
  it("returns true for ENOENT-like messages", () => {
    expect(isMissingFileReadError("ENOENT: no such file or directory")).toBe(true);
    expect(isMissingFileReadError("The system cannot find the file specified")).toBe(true);
  });

  it("returns true for localized missing-file text", () => {
    expect(isMissingFileReadError("系统找不到指定的文件")).toBe(true);
  });

  it("returns true for missing-path text", () => {
    expect(isMissingFileReadError("Path does not exist")).toBe(true);
    expect(isMissingFileReadError("path not found")).toBe(true);
  });

  it("returns true for error objects with missing-file message", () => {
    expect(isMissingFileReadError(new Error("target file not found"))).toBe(true);
  });

  it("returns false for unrelated failures", () => {
    expect(isMissingFileReadError("permission denied")).toBe(false);
    expect(isMissingFileReadError(new Error("network timeout"))).toBe(false);
  });
});

