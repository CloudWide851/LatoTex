import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("LatexWorkspaceEditorPanel compile state contract", () => {
  it("limits compileBusy to compile-dependent editor actions", () => {
    const panelSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/app/components/editor/LatexWorkspaceEditorPanel.tsx"),
      "utf8",
    );
    const toolbarSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/app/components/editor/LatexEditorToolbarActions.tsx"),
      "utf8",
    );

    expect(panelSource).toContain("compileBusy={compileBusy}");
    expect(toolbarSource).toContain("disabled={busy || compileBusy || !isTexPath(selectedFile)}");
    expect(toolbarSource).toContain("autoFixDisabled={busy || compileBusy || compileAssistAutoFixBusy}");
    expect(toolbarSource).toContain("const editorWriteDisabled = busy || selectedFileWriteLocked");
    expect(panelSource).toContain("<EditorTabsBar");
    expect(panelSource).toContain("busy={busy}");
    expect(panelSource).not.toContain("busy={busy || compileBusy}");
  });
});
