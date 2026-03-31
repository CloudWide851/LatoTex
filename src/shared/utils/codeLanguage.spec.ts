import { describe, expect, it } from "vitest";
import { extensionOfPath, isLatexLikePath, resolveCodeLanguage } from "./codeLanguage";

describe("codeLanguage", () => {
  it("normalizes extensions across Windows and Unix-style paths", () => {
    expect(extensionOfPath("src/main.rs")).toBe("rs");
    expect(extensionOfPath("src\\main.TS")).toBe("ts");
    expect(extensionOfPath("Dockerfile")).toBe("dockerfile");
  });

  it("resolves editor and preview languages for common source files", () => {
    expect(resolveCodeLanguage("src/app/AppContainerView.tsx")).toEqual({
      monaco: "typescript",
      highlight: "typescript",
    });
    expect(resolveCodeLanguage("scripts/setup.ps1")).toEqual({
      monaco: "powershell",
      highlight: "powershell",
    });
    expect(resolveCodeLanguage("README.unknown")).toEqual({
      monaco: "plaintext",
      highlight: null,
    });
  });

  it("keeps LaTeX-like files classified for editor language decisions", () => {
    expect(isLatexLikePath("paper/main.tex")).toBe(true);
    expect(isLatexLikePath("styles/custom.sty")).toBe(true);
    expect(isLatexLikePath("src/main.rs")).toBe(false);
  });
});

