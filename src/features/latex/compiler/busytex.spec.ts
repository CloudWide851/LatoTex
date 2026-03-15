import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type CompilePayload = {
  success?: boolean;
  pdf?: Uint8Array | ArrayBuffer | number[];
  log?: string;
  logs?: unknown;
  exitCode?: number;
};

let mockCompilePayload: CompilePayload = {};
let initializedBasePaths = new Set<string>();
let runnerInitCalls: string[] = [];
let runnerInitFailureResolver: (basePath: string, attempt: number) => string | null = () => null;
let runnerInitAttemptsByPath = new Map<string, number>();

vi.mock("texlyre-busytex", () => {
  class MockBusyTexRunner {
    private readonly basePath: string;

    constructor(input: { busytexBasePath: string }) {
      this.basePath = String(input?.busytexBasePath ?? "");
    }

    initialize() {
      const currentAttempt = (runnerInitAttemptsByPath.get(this.basePath) ?? 0) + 1;
      runnerInitAttemptsByPath.set(this.basePath, currentAttempt);
      runnerInitCalls.push(this.basePath);
      const failure = runnerInitFailureResolver(this.basePath, currentAttempt);
      if (failure) {
        return Promise.reject(new Error(failure));
      }
      initializedBasePaths.add(this.basePath);
      return Promise.resolve();
    }

    isInitialized() {
      return initializedBasePaths.has(this.basePath);
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
    mockCompilePayload = {};
    initializedBasePaths = new Set<string>();
    runnerInitCalls = [];
    runnerInitAttemptsByPath = new Map<string, number>();
    runnerInitFailureResolver = () => null;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock("@tauri-apps/api/core");
    vi.doUnmock("../../../shared/api/desktop");
    vi.resetModules();
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
    expect(runnerInitCalls.length).toBeGreaterThan(0);
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

  it("returns actionable diagnostics when all runner candidates fail to initialize", async () => {
    runnerInitFailureResolver = () => "busytex_worker.js not found";
    vi.resetModules();
    const { compileWithBusyTeX } = await import("./busytex");

    const result = await compileWithBusyTeX("\\begin{document}Hi\\end{document}", {}, "main.tex");

    expect(result.status).toBe("error");
    expect(result.diagnostics.join(" ")).toContain("BusyTeX assets missing");
  });

  it("normalizes encoded windows asset paths (including %2F) from tauri cache", async () => {
    mockCompilePayload = {
      success: true,
      pdf: [1, 2, 3],
      logs: [],
      exitCode: 0,
    };
    runnerInitFailureResolver = (basePath) => {
      if (basePath.includes("F:/LatoTex/busytex-cache")) {
        return null;
      }
      if (basePath.includes("F%3A%2FLatoTex%2Fbusytex-cache")) {
        return "failed to fetch";
      }
      return null;
    };

    vi.doMock("@tauri-apps/api/core", () => ({
      isTauri: () => true,
      convertFileSrc: () => "http://asset.localhost/F%3A%2FLatoTex%2Fbusytex-cache",
    }));
    vi.doMock("../../../shared/api/desktop", () => ({
      busytexCachePrepare: vi.fn(async () => ({
        policy: "install-first",
        requestedDir: "F:\\LatoTex\\busytex-cache",
        actualDir: "F:\\LatoTex\\busytex-cache",
        installDirWritable: true,
        usingFallback: false,
      })),
    }));
    vi.resetModules();

    const { compileWithBusyTeX } = await import("./busytex");
    const result = await compileWithBusyTeX("\\begin{document}Hi\\end{document}", {}, "main.tex");

    expect(result.status).toBe("success");
    expect(runnerInitCalls.some((basePath) => basePath.includes("F:/LatoTex/busytex-cache"))).toBe(true);
  });

  it("re-prepares cache and retries once for recoverable asset errors", async () => {
    mockCompilePayload = {
      success: true,
      pdf: [1, 2, 3],
      logs: [],
      exitCode: 0,
    };
    let cachePrepareCount = 0;

    runnerInitFailureResolver = (basePath) => {
      if (basePath.includes("good-cache")) {
        return null;
      }
      return "busytex_worker.js not found";
    };

    vi.doMock("@tauri-apps/api/core", () => ({
      isTauri: () => true,
      convertFileSrc: (value: string) => `http://asset.localhost/${value.replace(/\\/g, "/")}`,
    }));
    vi.doMock("../../../shared/api/desktop", () => ({
      busytexCachePrepare: vi.fn(async () => {
        cachePrepareCount += 1;
        const dir = cachePrepareCount === 1 ? "F:\\bad-cache" : "F:\\good-cache";
        return {
          policy: "install-first",
          requestedDir: dir,
          actualDir: dir,
          installDirWritable: true,
          usingFallback: false,
        };
      }),
    }));

    vi.resetModules();
    const { compileWithBusyTeX } = await import("./busytex");
    const result = await compileWithBusyTeX("\\begin{document}Hi\\end{document}", {}, "main.tex");

    expect(result.status).toBe("success");
    expect(cachePrepareCount).toBeGreaterThanOrEqual(2);
    expect(runnerInitCalls.some((basePath) => basePath.includes("good-cache"))).toBe(true);
  });
});
