import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function css(relativePath: string) {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

describe("icon control alignment contract", () => {
  it("centers shared panel and editor-tab icon controls without SVG baselines", () => {
    const controls = css("src/styles/control-system.css");
    const editor = css("src/index.css");

    expect(controls).toMatch(/\.panel-topbar-btn\s*\{[^}]*display:\s*inline-flex;/s);
    expect(controls).toMatch(/\.panel-topbar-btn\s*\{[^}]*align-items:\s*center;/s);
    expect(controls).toMatch(/\.panel-topbar-btn\s*\{[^}]*justify-content:\s*center;/s);
    expect(controls).toMatch(/\.panel-topbar-btn\s*>\s*svg\s*\{[^}]*display:\s*block;/s);
    expect(editor).toMatch(/\.editor-tab-action\s*\{[^}]*align-items:\s*center;/s);
    expect(editor).toMatch(/\.editor-tab-action\s*>\s*svg\s*\{[^}]*display:\s*block;/s);
  });
});
