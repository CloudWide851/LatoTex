import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CodeLanguageInfo } from "../../shared/utils/codeLanguage";
import { clearCodePreviewHighlightCache, renderCodePreviewHtml } from "./codePreviewHighlight";

const hljsMock = vi.hoisted(() => ({
  getLanguage: vi.fn(),
  highlight: vi.fn(),
}));

vi.mock("highlight.js", () => ({
  default: hljsMock,
}));

const tsLanguage: CodeLanguageInfo = {
  monaco: "typescript",
  highlight: "typescript",
};

describe("renderCodePreviewHtml", () => {
  beforeEach(() => {
    clearCodePreviewHighlightCache();
    hljsMock.getLanguage.mockReset();
    hljsMock.highlight.mockReset();
    hljsMock.getLanguage.mockReturnValue(true);
    hljsMock.highlight.mockImplementation((source: string) => ({
      value: `<span>${source}</span>`,
    }));
  });

  it("reuses the cached highlighted html for the same file path", () => {
    expect(renderCodePreviewHtml("const a = 1;", tsLanguage, "ts", "src/demo.ts")).toContain("<span>");
    expect(renderCodePreviewHtml("const a = 1;", tsLanguage, "ts", "src/demo.ts")).toContain("<span>");

    expect(hljsMock.highlight).toHaveBeenCalledTimes(1);
  });

  it("keeps highlight cache file-scoped", () => {
    renderCodePreviewHtml("const a = 1;", tsLanguage, "ts", "src/demo-a.ts");
    renderCodePreviewHtml("const a = 1;", tsLanguage, "ts", "src/demo-b.ts");

    expect(hljsMock.highlight).toHaveBeenCalledTimes(2);
  });

  it("returns cached escaped html for unsupported highlight languages", () => {
    hljsMock.getLanguage.mockReturnValue(false);

    expect(renderCodePreviewHtml("<demo>", tsLanguage, "ts", "src/plain.ts")).toBe("&lt;demo&gt;");
    expect(renderCodePreviewHtml("<demo>", tsLanguage, "ts", "src/plain.ts")).toBe("&lt;demo&gt;");

    expect(hljsMock.highlight).not.toHaveBeenCalled();
  });
});
