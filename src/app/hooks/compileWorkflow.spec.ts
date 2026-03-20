import { describe, expect, it } from "vitest";
import {
  applySystemFontFallbackToFileMap,
  applySystemFontFallbackToSource,
  collectConfiguredSystemFontsFromFileMap,
  extractConfiguredSystemFontsFromSource,
  extractMissingStyleCandidatesFromDiagnostics,
  extractMissingSystemFontsFromDiagnostics,
  hasFontspecErrorDiagnostics,
} from "./compileWorkflow";

describe("compile workflow missing package detection", () => {
  it("detects missing styles and ignores fontspec package-error false positives", () => {
    const diagnostics = [
      "! LaTeX Error: File `ctex.sty' not found.",
      "! Package fontspec Error: The font \"Times New Roman\" cannot be found.",
      "! Package geometry Error: test",
      "xdvipdfmx:fatal: Could not open specified DVI (or XDV) file: main.xdv",
    ];

    const candidates = extractMissingStyleCandidatesFromDiagnostics(diagnostics);

    expect(candidates).toContain("ctex.sty");
    expect(candidates).toContain("geometry.sty");
    expect(candidates).not.toContain("fontspec.sty");
  });

  it("deduplicates candidates", () => {
    const diagnostics = [
      "! Package geometry Error: one",
      "! Package geometry Error: two",
      "! LaTeX Error: File `geometry.sty' not found.",
    ];

    const candidates = extractMissingStyleCandidatesFromDiagnostics(diagnostics);
    expect(candidates.filter((item) => item.toLowerCase() === "geometry.sty")).toHaveLength(1);
  });

  it("splits combined diagnostics when style-not-found is concatenated", () => {
    const diagnostics = [
      "xdvipdfmx:fatal: Could not open specified DVI (or XDV) file: main.xdvNo output PDF file written.! LaTeX Error: File `ctex.sty' not found.",
    ];

    const candidates = extractMissingStyleCandidatesFromDiagnostics(diagnostics);
    expect(candidates).toContain("ctex.sty");
  });
});

describe("compile workflow fontspec fallback", () => {
  it("extracts missing system font families", () => {
    const diagnostics = [
      "! Package fontspec Error: The font \"Times New Roman\" cannot be found.",
      "Package fontspec Error: font Arial not found",
    ];

    const fonts = extractMissingSystemFontsFromDiagnostics(diagnostics);
    expect(fonts).toEqual(["Times New Roman", "Arial"]);
  });

  it("replaces setmainfont and newfontfamily with fallback fonts", () => {
    const source = String.raw`\usepackage{fontspec}
\setmainfont{Times New Roman}
\newfontfamily\titlefont{Arial}
\begin{document}
hello
\end{document}`;

    const output = applySystemFontFallbackToSource(source, ["Times New Roman", "Arial"]);

    expect(output.patchedSource).toContain("\\setmainfont{Latin Modern Roman}");
    expect(output.patchedSource).toContain("\\newfontfamily\\titlefont{Latin Modern Sans}");
    expect(output.replacements.length).toBe(2);
  });

  it("detects generic fontspec errors without explicit font family", () => {
    const diagnostics = [
      "! Package fontspec Error: Font \"\" cannot be found.",
      "Package fontspec Error: The font cannot be found.",
    ];
    expect(hasFontspecErrorDiagnostics(diagnostics)).toBe(true);
  });

  it("extracts configured font names for conservative fallback", () => {
    const source = String.raw`\setmainfont{Times New Roman}
\setsansfont{Arial}
\newfontfamily\codefont{Consolas}`;

    expect(extractConfiguredSystemFontsFromSource(source)).toEqual([
      "Times New Roman",
      "Arial",
      "Consolas",
    ]);
  });

  it("collects configured font names from compile file map", () => {
    const fileMap = {
      "main.tex": String.raw`\setmainfont{Times New Roman}`,
      "sections/body.tex": String.raw`\setsansfont{Arial}`,
      "assets/readme.md": "# no latex commands",
    };

    expect(collectConfiguredSystemFontsFromFileMap(fileMap)).toEqual([
      "Times New Roman",
      "Arial",
    ]);
  });

  it("applies fallback across main and additional tex files", () => {
    const fileMap = {
      "main.tex": String.raw`\setmainfont{Times New Roman}`,
      "sections/body.tex": String.raw`\newfontfamily\titlefont{Arial}`,
      "image.png": "binary",
    };

    const patched = applySystemFontFallbackToFileMap(fileMap, "main.tex", ["Times New Roman", "Arial"]);

    expect(patched.changed).toBe(true);
    expect(patched.mainSource).toContain("\\setmainfont{Latin Modern Roman}");
    expect(patched.overlays["sections/body.tex"]).toContain("\\newfontfamily\\titlefont{Latin Modern Sans}");
    expect(patched.replacements).toHaveLength(2);
  });

  it("ignores non-font one-letter candidates from fontspec diagnostics", () => {
    const diagnostics = [
      "! Package fontspec Error: The font \"L\" cannot be found.",
      "! Package fontspec Error: The font \"KaiTi\" cannot be found.",
    ];

    expect(extractMissingSystemFontsFromDiagnostics(diagnostics)).toEqual(["KaiTi"]);
  });

  it("does not rewrite CJK font commands during fallback", () => {
    const source = String.raw`\setCJKmainfont{SimSun}
\setmainfont{Times New Roman}`;

    const output = applySystemFontFallbackToSource(source, ["SimSun", "Times New Roman"]);

    expect(output.patchedSource).toContain("\\setCJKmainfont{SimSun}");
    expect(output.patchedSource).toContain("\\setmainfont{Latin Modern Roman}");
  });

  it("does not patch style files when applying fallback across compile map", () => {
    const fileMap = {
      "main.tex": String.raw`\setmainfont{Times New Roman}`,
      "styles/fontdefs.sty": String.raw`\setmainfont{Times New Roman}`,
    };

    const patched = applySystemFontFallbackToFileMap(fileMap, "main.tex", ["Times New Roman"]);

    expect(patched.mainSource).toContain("\\setmainfont{Latin Modern Roman}");
    expect(patched.overlays["styles/fontdefs.sty"]).toBeUndefined();
  });
});