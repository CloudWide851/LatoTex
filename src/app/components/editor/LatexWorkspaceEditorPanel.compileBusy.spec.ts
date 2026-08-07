import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("LatexWorkspaceEditorPanel compile state contract", () => {
  it("limits compileBusy to compile-dependent editor actions", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/app/components/editor/LatexWorkspaceEditorPanel.tsx"),
      "utf8",
    );

    expect(source).toContain("disabled={busy || compileBusy || !canCompileSelectedFile}");
    expect(source).toContain("autoFixDisabled={busy || compileBusy || compileAssistAutoFixBusy}");
    expect(source).toContain("<EditorTabsBar");
    expect(source).toContain("busy={busy}");
    expect(source).not.toContain("busy={busy || compileBusy}");
    expect(source.match(/disabled=\{busy\}/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
  });
});
