import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type CompilePayload = {
  success?: boolean;
  pdf?: Uint8Array | ArrayBuffer | number[];
  log?: string;
  logs?: unknown;
  exitCode?: number;
};

let mockCompilePayload: CompilePayload = {};
let mockInitialized = false;

vi.mock("texlyre-busytex", () => {
  class MockBusyTexRunner {
    constructor(_: unknown) {}

    initialize() {
      mockInitialized = true;
      return Promise.resolve();
    }

    isInitialized() {
      return mockInitialized;
    }
  }

  class MockXeLatex {
    constructor(_: unknown) {}

    compile() {
      return Promise.resolve(mockCompilePayload);
    }
  }

  return {
    BusyTexRunner: MockBusyTexRunner,
    XeLatex: MockXeLatex,
  };
});

describe("BusyTeX compile adapter", () => {
  beforeEach(() => {
    mockInitialized = false;
    mockCompilePayload = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("self.onmessage = () => {}", { status: 200 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps successful compile output to a success result", async () => {
    mockCompilePayload = {
      success: true,
      pdf: [1, 2, 3, 4],
      logs: ["ok"],
      log: "done",
      exitCode: 0,
    };
    vi.resetModules();
    const { compileWithBusyTeX } = await import("./busytex");

    const result = await compileWithBusyTeX("\\begin{document}Hi\\end{document}", {}, "main.tex");

    expect(result.status).toBe("success");
    expect(result.pdfBytes).toBeInstanceOf(Uint8Array);
    expect(result.pdfBytes?.length).toBe(4);
    expect(result.diagnostics).toContain("done");
  });

  it("maps unsuccessful compile output to an error result", async () => {
    mockCompilePayload = {
      success: false,
      logs: ["latex error"],
      exitCode: 2,
    };
    vi.resetModules();
    const { compileWithBusyTeX } = await import("./busytex");

    const result = await compileWithBusyTeX("\\begin{document}Hi\\end{document}", {}, "main.tex");

    expect(result.status).toBe("error");
    expect(result.diagnostics.join(" ")).toContain("latex error");
  });

  it("returns actionable diagnostics when worker asset resolves to html", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<!doctype html><html></html>", { status: 200 })),
    );
    vi.resetModules();
    const { compileWithBusyTeX } = await import("./busytex");

    const result = await compileWithBusyTeX("\\begin{document}Hi\\end{document}", {}, "main.tex");

    expect(result.status).toBe("error");
    expect(result.diagnostics.join(" ")).toContain("BusyTeX assets missing");
  });
});

