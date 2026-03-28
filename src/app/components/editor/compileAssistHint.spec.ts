import { describe, expect, it } from "vitest";
import { buildCompileAssistHint, prioritizeCompileDiagnostics } from "./compileAssistHint";

const messages: Record<string, string> = {
  "workspace.compileAssist.hintTitle": "Compile Repair Hint",
  "workspace.compileAssist.hintMissingPackage": "Missing package detected: {package}",
  "workspace.compileAssist.hintMissingCtex": "ctex runtime hint",
  "workspace.compileAssist.hintCjkMissingConfig": "cjk setup hint",
  "workspace.compileAssist.hintCjkAutoFix": "cjk auto fix hint",
  "workspace.compileAssist.hintFontspecXdv": "fontspec xdv hint",
  "workspace.compileAssist.hintMissingMathShift": "math shift hint",
  "workspace.compileAssist.hintGeneric": "generic hint",
  "workspace.compileAssist.cjkDetectedDiagnostic": "Chinese source detected without CJK setup.",
  "workspace.compileAssist.cjkMissingGlyphDiagnostic": "Chinese glyphs are missing from the current preview.",
};

const t = (key: any) => messages[String(key)] || String(key);

describe("compileAssistHint", () => {
  it("filters package progress noise and keeps priority errors", () => {
    const hint = buildCompileAssistHint([
      'note: "version 2" Tectonic command-line interface activated',
      "Package progress 1/2.",
      "Installing package xeCJK.sty...",
      "! LaTeX Error: File `ctex.sty' not found.",
      "xdvipdfmx:fatal: Could not open specified DVI (or XDV) file: main.xdv",
    ], t);

    expect(hint).toContain("1. ! LaTeX Error: File `ctex.sty' not found.");
    expect(hint).toContain("2. xdvipdfmx:fatal: Could not open specified DVI (or XDV) file: main.xdv");
    expect(hint).not.toContain("Package progress");
    expect(hint).not.toContain("Tectonic command-line interface activated");
    expect(hint).toContain("ctex runtime hint");
  });

  it("adds dedicated fontspec xdv hint when fontspec/xdv/pdf chain appears", () => {
    const hint = buildCompileAssistHint([
      '! Package fontspec Error: The font "SimSun" cannot be found.',
      "xdvipdfmx:fatal: Could not open specified DVI (or XDV) file: main.xdv",
      "No output PDF file written.",
    ], t);

    expect(hint).toContain("fontspec xdv hint");
  });

  it("prioritizes the first real latex error ahead of note noise", () => {
    const diagnostics = prioritizeCompileDiagnostics([
      'note: using only cached resource files',
      'note: Running TeX ...',
      'error: main.tex:93: Missing $ inserted',
      'error: halted on potentially-recoverable error as specified',
    ]);

    expect(diagnostics).toEqual([
      'error: main.tex:93: Missing $ inserted',
      'error: halted on potentially-recoverable error as specified',
    ]);
  });

  it("adds a dedicated hint for missing math shift errors", () => {
    const hint = buildCompileAssistHint([
      'error: main.tex:93: Missing $ inserted',
    ], t);

    expect(hint).toContain("math shift hint");
  });

  it("adds Chinese auto-fix guidance when source contains Chinese without xeCJK", () => {
    const hint = buildCompileAssistHint([], t, {
      source: String.raw`\documentclass{article}
\begin{document}
中文
\end{document}`,
    });

    expect(hint).toContain("Chinese source detected without CJK setup.");
    expect(hint).toContain("cjk setup hint");
    expect(hint).toContain("cjk auto fix hint");
  });

  it("prioritizes missing character diagnostics for Chinese glyph issues", () => {
    const diagnostics = prioritizeCompileDiagnostics([
      'note: using only cached resource files',
      'Missing character: There is no 中 (U+4E2D) in font [lmroman10-regular]:mapping=t',
      'warning: overfull hbox',
    ]);

    expect(diagnostics[0]).toContain("Missing character:");
  });
});
