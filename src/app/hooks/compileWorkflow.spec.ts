import { describe, expect, it } from "vitest";
import {
  applySystemFontFallbackToFileMap,
  applySystemFontFallbackToSource,
  collectConfiguredSystemFontsFromFileMap,
  extractConfiguredSystemFontsFromSource,
  extractMissingStyleCandidatesFromDiagnostics,
  extractMissingSystemFontsFromDiagnostics,
  hasFontspecErrorDiagnostics,
  resolveFontFallbackCandidates,
  shouldIncludeCompileFile,
  shouldDisplayCompileProgress,
} from "./compileWorkflow";
import { collectBibliographyResourcePathsFromFileMap } from "./compileBibliographyFiles";

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

  it("keeps extracted and configured fonts even when probe only reports a subset", () => {
    expect(resolveFontFallbackCandidates({
      extractedFonts: ["SimSun"],
      configuredFonts: ["Times New Roman", "Arial"],
      probeMissingFonts: ["Arial"],
    })).toEqual(["SimSun", "Times New Roman", "Arial"]);
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

  it("extracts configured font names for conservative fallback including CJK families", () => {
    const source = String.raw`\setmainfont{Times New Roman}
\setsansfont{Arial}
\setCJKfamilyfont{song}{SimSun}
\newfontfamily\codefont{Consolas}
\newCJKfontfamily\myhei{SimHei}`;

    expect(extractConfiguredSystemFontsFromSource(source)).toEqual([
      "Times New Roman",
      "Arial",
      "SimSun",
      "Consolas",
      "SimHei",
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

  it("rewrites CJK font commands during fallback", () => {
    const source = String.raw`\setCJKmainfont{SimSun}
\setCJKfamilyfont{song}{KaiTi}
\newCJKfontfamily\myhei{SimHei}
\setmainfont{Times New Roman}`;

    const output = applySystemFontFallbackToSource(source, ["SimSun", "KaiTi", "SimHei", "Times New Roman"]);

    expect(output.patchedSource).toContain("\\setCJKmainfont{FandolSong-Regular}");
    expect(output.patchedSource).toContain("\\setCJKfamilyfont{song}{FandolSong-Regular}");
    expect(output.patchedSource).toContain("\\newCJKfontfamily\\myhei{FandolSong-Regular}");
    expect(output.patchedSource).toContain("\\setmainfont{Latin Modern Roman}");
  });

  it("patches project style files when applying fallback across compile map", () => {
    const fileMap = {
      "main.tex": String.raw`\setmainfont{Times New Roman}`,
      "styles/fontdefs.sty": String.raw`\setmainfont{Times New Roman}`,
    };

    const patched = applySystemFontFallbackToFileMap(fileMap, "main.tex", ["Times New Roman"]);

    expect(patched.mainSource).toContain("\\setmainfont{Latin Modern Roman}");
    expect(patched.overlays["styles/fontdefs.sty"]).toContain("\\setmainfont{Latin Modern Roman}");
  });
});
describe("compile workflow progress visibility", () => {
  it("hides queued progress before native compile enters a real stage", () => {
    expect(shouldDisplayCompileProgress({
      active: true,
      percent: 0,
      stage: "queued",
      currentPackage: "main.tex",
      completed: 0,
      total: 100,
      message: "Queued",
    })).toBe(false);
  });

  it("shows progress for active native compile stages", () => {
    expect(shouldDisplayCompileProgress({
      active: true,
      percent: 28,
      stage: "starting_tectonic",
      currentPackage: "main.tex",
      completed: 28,
      total: 100,
      message: "Starting Tectonic",
    })).toBe(true);
  });
});

describe("compile workflow file staging", () => {
  it("includes only LaTeX compile text resources", () => {
    expect(shouldIncludeCompileFile("main.tex")).toBe(true);
    expect(shouldIncludeCompileFile("styles/local.sty")).toBe(true);
    expect(shouldIncludeCompileFile(".latotex/papers/source.bib")).toBe(true);
    expect(shouldIncludeCompileFile("测试.docx")).toBe(false);
    expect(shouldIncludeCompileFile("prompt.txt")).toBe(false);
    expect(shouldIncludeCompileFile("sales_transactions.csv")).toBe(false);
    expect(shouldIncludeCompileFile("figure.png")).toBe(false);
    expect(shouldIncludeCompileFile("extensionless")).toBe(false);
  });
});

describe("compile workflow bibliography resources", () => {
  it("collects biblatex and BibTeX resources including paper-library paths", () => {
    const fileMap = {
      "main.tex": String.raw`\addbibresource{.latotex/papers/library paper.bib}
\bibliography{refs/local,.latotex/papers/nested/remote}`,
      "sections/intro.tex": String.raw`\addbibresource[datatype=bibtex]{refs/extra.bib}`,
      "notes.md": "\\bibliography{ignored}",
    };

    expect(collectBibliographyResourcePathsFromFileMap(fileMap)).toEqual([
      ".latotex/papers/library paper.bib",
      "refs/local.bib",
      ".latotex/papers/nested/remote.bib",
      "refs/extra.bib",
    ]);
  });
});

