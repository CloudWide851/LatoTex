import fs from "node:fs";
import { describe, expect, it } from "vitest";

function readStyles(path: string): string {
  return fs.readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
}

const rootStyles = readStyles("../../index.css");
const controlStyles = readStyles("../../styles/control-system.css");
const shareStyles = readStyles("../../share-page/index.css");

describe("material ownership", () => {
  it("keeps blur on top-level material owners and suppresses nested panel blur", () => {
    expect(controlStyles).toContain(".app-material-shell,\n.app-material-panel,\n.app-material-floating");
    expect(controlStyles).toContain(":where(.app-material-shell, .app-material-panel)\n  :where(.app-material-panel, .app-material-content, .app-material-inset)");
    expect(controlStyles).toMatch(/:where\(\.app-material-panel, \.app-material-content, \.app-material-inset\)[\s\S]*?backdrop-filter: none/);
  });

  it("keeps editor and document surfaces outside the glass compositor", () => {
    expect(rootStyles).toMatch(/\.editor-workspace-shell[\s\S]*?backdrop-filter: none/);
    expect(controlStyles).toMatch(/\.app-document-surface[\s\S]*?backdrop-filter: none/);
    expect(shareStyles).toMatch(/\.share-document-surface[\s\S]*?backdrop-filter: none/);
  });

  it("uses a neutral canvas without decorative share-page gradients", () => {
    expect(rootStyles).toContain("--app-material-canvas: #f5f5f7");
    expect(shareStyles).toContain("--share-canvas: #f5f5f7");
    expect(shareStyles).not.toContain("radial-gradient");
  });
});
