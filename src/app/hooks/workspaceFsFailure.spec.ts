import { describe, expect, it } from "vitest";
import { resolveWorkspaceFsFailureCode, workspaceFsFailureMessage } from "./workspaceFsFailure";

describe("workspaceFsFailure", () => {
  it("extracts stable codes from native error wrappers", () => {
    expect(resolveWorkspaceFsFailureCode(new Error("workspace.path.reparse_denied"))).toBe(
      "workspace.path.reparse_denied",
    );
    expect(resolveWorkspaceFsFailureCode("invoke failed: workspace.file_read.too_large")).toBe(
      "workspace.file_read.too_large",
    );
  });

  it("never renders an unknown raw native error", () => {
    const t = (key: string) => `translated:${key}`;
    expect(workspaceFsFailureMessage("secret-shaped internal detail", t)).toBe(
      "translated:toast.workspaceOperationFailed",
    );
  });
});
