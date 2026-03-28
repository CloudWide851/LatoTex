import { describe, expect, it } from "vitest";
import {
  applyCjkAutoFixToSource,
  buildCompileAssistCjkDiagnostics,
  detectCompileAssistCjkIssue,
  sourceContainsChineseText,
  sourceHasExplicitCjkSupport,
} from "./compileAssistCjk";

const messages: Record<string, string> = {
  "workspace.compileAssist.cjkDetectedDiagnostic": "Chinese source detected without CJK setup.",
  "workspace.compileAssist.cjkMissingGlyphDiagnostic": "Chinese glyphs are missing from the current preview.",
};

const t = (key: any) => messages[String(key)] || String(key);

describe("compileAssistCjk", () => {
  it("detects Chinese source without explicit CJK support", () => {
    const source = String.raw`\documentclass{article}
\begin{document}
中文
\end{document}
`;

    expect(sourceContainsChineseText(source)).toBe(true);
    expect(sourceHasExplicitCjkSupport(source)).toBe(false);
    expect(detectCompileAssistCjkIssue({ source })).toEqual({ kind: "source-missing-cjk" });
  });

  it("ignores sources that already configure xeCJK", () => {
    const source = String.raw`\documentclass{article}
\usepackage{xeCJK}
\begin{document}
中文
\end{document}
`;

    expect(sourceHasExplicitCjkSupport(source)).toBe(true);
    expect(detectCompileAssistCjkIssue({ source })).toBeNull();
  });

  it("detects missing glyph diagnostics for Chinese content", () => {
    const source = String.raw`\documentclass{article}
\begin{document}
中文
\end{document}
`;
    const issue = detectCompileAssistCjkIssue({
      source,
      diagnostics: [
        "Missing character: There is no 中 (U+4E2D) in font [lmroman10-regular]:mapping=t",
      ],
    });

    expect(issue).toEqual({
      kind: "diagnostic-missing-cjk",
      line: "Missing character: There is no 中 (U+4E2D) in font [lmroman10-regular]:mapping=t",
    });
    expect(buildCompileAssistCjkDiagnostics(t, issue!)).toContain(
      "Chinese glyphs are missing from the current preview.",
    );
  });

  it("injects xeCJK and Fandol config after documentclass", () => {
    const source = String.raw`\documentclass{article}
\usepackage{amsmath}
\begin{document}
中文
\end{document}
`;

    const patched = applyCjkAutoFixToSource(source);

    expect(patched.changed).toBe(true);
    expect(patched.patchedSource).toContain("\\usepackage{xeCJK}");
    expect(patched.patchedSource.indexOf("\\usepackage{xeCJK}")).toBeLessThan(
      patched.patchedSource.indexOf("\\usepackage{amsmath}"),
    );
  });

  it("does not inject twice", () => {
    const source = String.raw`\documentclass{article}
% LatoTex auto-fix: Chinese support for Tectonic/XeLaTeX
\usepackage{xeCJK}
\setCJKmainfont{FandolSong-Regular}[Extension=.otf,BoldFont=FandolSong-Bold,ItalicFont=FandolKai-Regular]
\setCJKsansfont{FandolHei-Regular}[Extension=.otf,BoldFont=FandolHei-Bold]
\setCJKmonofont{FandolFang-Regular}[Extension=.otf]
\begin{document}
中文
\end{document}
`;

    const patched = applyCjkAutoFixToSource(source);

    expect(patched.changed).toBe(false);
    expect(patched.patchedSource).toBe(source);
  });
});

