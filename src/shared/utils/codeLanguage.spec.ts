import { describe, expect, it } from "vitest";
import { extensionOfPath, isLatexLikePath, resolveCodeLanguage, resolveCodeLanguageTag } from "./codeLanguage";

describe("codeLanguage", () => {
  it("normalizes extensions across Windows and Unix-style paths", () => {
    expect(extensionOfPath("src/main.rs")).toBe("rs");
    expect(extensionOfPath("src\\main.TS")).toBe("ts");
    expect(extensionOfPath("Dockerfile")).toBe("dockerfile");
    expect(extensionOfPath(".editorconfig")).toBe("editorconfig");
    expect(extensionOfPath(".gitignore")).toBe("gitignore");
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
    expect(resolveCodeLanguage("data/product_catalog.csv")).toEqual({
      monaco: "csv",
      highlight: null,
    });
    expect(resolveCodeLanguage(".editorconfig")).toEqual({
      monaco: "editorconfig",
      highlight: "ini",
    });
    expect(resolveCodeLanguage(".gitignore")).toEqual({
      monaco: "ignore",
      highlight: null,
    });
    expect(resolveCodeLanguage("papers/ref.bib")).toEqual({
      monaco: "bibtex",
      highlight: "latex",
    });
    expect(resolveCodeLanguage("frontend/components/App.vue")).toEqual({
      monaco: "html",
      highlight: "xml",
    });
    expect(resolveCodeLanguage("Gemfile.gemspec")).toEqual({
      monaco: "ruby",
      highlight: "ruby",
    });
    expect(resolveCodeLanguage("README.unknown")).toEqual({
      monaco: "plaintext",
      highlight: null,
    });
  });

  it("builds stable language tags for file-scoped highlight caches", () => {
    expect(resolveCodeLanguageTag("src/main.tsx")).toBe("tsx");
    expect(resolveCodeLanguageTag("Dockerfile")).toBe("dockerfile");
    expect(resolveCodeLanguageTag("README")).toBe("plaintext");
  });

  it("keeps LaTeX-like files classified for editor language decisions", () => {
    expect(isLatexLikePath("paper/main.tex")).toBe(true);
    expect(isLatexLikePath("styles/custom.sty")).toBe(true);
    expect(isLatexLikePath("src/main.rs")).toBe(false);
  });
});
