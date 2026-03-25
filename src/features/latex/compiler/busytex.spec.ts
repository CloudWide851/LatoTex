import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type CompilePayload = {
  success?: boolean;
  pdf?: Uint8Array | ArrayBuffer | number[];
  log?: string;
  logs?: unknown;
  exitCode?: number;
};

type InitCall = {
  basePath: string;
  useWorker: boolean;
};

let mockCompilePayload: CompilePayload = {};
let initializedByMode = new Set<string>();
let runnerInitCalls: InitCall[] = [];
let runnerInitFailureResolver: (basePath: string, attempt: number, useWorker: boolean) => string | null = () => null;
let runnerInitAttemptsByPathAndMode = new Map<string, number>();

vi.mock("texlyre-busytex", () => {
  class MockBusyTexRunner {
    private readonly basePath: string;

    constructor(input: { busytexBasePath: string }) {
      this.basePath = String(input?.busytexBasePath ?? "");
    }

    initialize(useWorker = true) {
      const key = `${this.basePath}::${useWorker ? "worker" : "direct"}`;
      const currentAttempt = (runnerInitAttemptsByPathAndMode.get(key) ?? 0) + 1;
      runnerInitAttemptsByPathAndMode.set(key, currentAttempt);
      runnerInitCalls.push({ basePath: this.basePath, useWorker });
      const failure = runnerInitFailureResolver(this.basePath, currentAttempt, useWorker);
      if (failure) {
        return Promise.reject(new Error(failure));
      }
      initializedByMode.add(key);
      return Promise.resolve();
    }

    isInitialized() {
      return initializedByMode.has(`${this.basePath}::worker`) || initializedByMode.has(`${this.basePath}::direct`);
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
    initializedByMode = new Set<string>();
    runnerInitCalls = [];
    runnerInitAttemptsByPathAndMode = new Map<string, number>();
    runnerInitFailureResolver = () => null;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock("@tauri-apps/api/core");
    vi.doUnmock("../../../shared/api/local-resources");
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

  it("uses local cache candidates only in tauri mode", async () => {
    mockCompilePayload = {
      success: true,
      pdf: [1, 2, 3],
      logs: [],
      exitCode: 0,
    };
    runnerInitFailureResolver = (basePath) => {
      if (basePath.includes("busytex-cache")) {
        return null;
      }
      return "failed to fetch";
    };

    vi.doMock("@tauri-apps/api/core", () => ({
      isTauri: () => true,
      convertFileSrc: () => {
        throw new Error("convertFileSrc should not be used for BusyTeX desktop init");
      },
    }));
    vi.doMock("../../../shared/api/local-resources", () => ({
      busytexCachePrepare: vi.fn(async () => ({
        policy: "install-first",
        requestedDir: "F:\\LatoTex\\busytex-cache",
        actualDir: "F:\\LatoTex\\busytex-cache",
        installDirWritable: true,
        usingFallback: false,
        baseUrl: "http://asset.localhost/F%3A%2FLatoTex%2Fbusytex-cache",
        candidateBaseUrls: ["http://asset.localhost/F:/LatoTex/busytex-cache"],
        preferredInitMode: "direct",
      })),
    }));
    vi.resetModules();

    const { compileWithBusyTeX } = await import("./busytex");
    const result = await compileWithBusyTeX("\\begin{document}Hi\\end{document}", {}, "main.tex");

    expect(result.status).toBe("success");
    expect(runnerInitCalls.some((call) => call.basePath.includes("asset.localhost"))).toBe(true);
    expect(runnerInitCalls.some((call) => call.basePath.includes("/core/busytex"))).toBe(false);
    expect(runnerInitCalls.every((call) => !call.useWorker)).toBe(true);
  });

  it("tries backend-provided install and appdata cache candidates in order", async () => {
    mockCompilePayload = {
      success: true,
      pdf: [2, 4, 6],
      logs: [],
      exitCode: 0,
    };
    runnerInitFailureResolver = (basePath) =>
      basePath.includes("install-cache") ? "busytex_worker.js not found" : null;

    vi.doMock("@tauri-apps/api/core", () => ({
      isTauri: () => true,
    }));
    vi.doMock("../../../shared/api/local-resources", () => ({
      busytexCachePrepare: vi.fn(async () => ({
        policy: "install-first",
        requestedDir: "F:\\install-cache",
        actualDir: "F:\\install-cache",
        installDirWritable: true,
        usingFallback: false,
        baseUrl: "http://asset.localhost/F:/install-cache",
        candidateBaseUrls: [
          "http://asset.localhost/F:/install-cache",
          "http://asset.localhost/C:/Users/test/AppData/Roaming/LatoTex/busytex-cache",
        ],
        preferredInitMode: "direct",
      })),
    }));

    vi.resetModules();
    const { compileWithBusyTeX } = await import("./busytex");
    const result = await compileWithBusyTeX("\\begin{document}Hi\\end{document}", {}, "main.tex");

    expect(result.status).toBe("success");
    expect(runnerInitCalls[0]?.basePath).toContain("install-cache");
    expect(runnerInitCalls[1]?.basePath).toContain("AppData");
  });

  it("falls back to direct initialization in tauri when worker bootstrap hits origin errors", async () => {
    mockCompilePayload = {
      success: true,
      pdf: [5, 6, 7],
      logs: [],
      exitCode: 0,
    };

    runnerInitFailureResolver = (_basePath, _attempt, useWorker) =>
      useWorker ? "Failed to construct 'Worker': Script at http://asset.localhost/busytex_worker.js cannot be accessed from origin" : null;

    vi.doMock("@tauri-apps/api/core", () => ({
      isTauri: () => true,
    }));
    vi.doMock("../../../shared/api/local-resources", () => ({
      busytexCachePrepare: vi.fn(async () => ({
        policy: "install-first",
        requestedDir: "F:\\busytex-cache",
        actualDir: "F:\\busytex-cache",
        installDirWritable: true,
        usingFallback: false,
        baseUrl: "http://asset.localhost/F%3A%2Fbusytex-cache",
        preferredInitMode: "worker",
      })),
    }));

    vi.resetModules();
    const { compileWithBusyTeX } = await import("./busytex");
    const result = await compileWithBusyTeX("\\begin{document}Hi\\end{document}", {}, "main.tex");

    expect(result.status).toBe("success");
    expect(runnerInitCalls.some((call) => call.useWorker)).toBe(true);
    expect(runnerInitCalls.some((call) => !call.useWorker)).toBe(true);
  });

  it("re-prepares cache and retries once with appdata fallback for recoverable asset errors", async () => {
    mockCompilePayload = {
      success: true,
      pdf: [1, 2, 3],
      logs: [],
      exitCode: 0,
    };

    runnerInitFailureResolver = (basePath) => {
      if (basePath.includes("good-cache")) {
        return null;
      }
      return "busytex_worker.js not found";
    };

    const busytexCachePrepareMock = vi.fn(async (policy: "install-first" | "appdata-only") => {
      const dir = policy === "install-first" ? "F:\\bad-cache" : "C:\\Users\\test\\AppData\\Roaming\\LatoTex\\good-cache";
      return {
        policy,
        requestedDir: dir,
        actualDir: dir,
        installDirWritable: true,
        usingFallback: false,
        baseUrl: `http://asset.localhost/${dir.replace(/\\/g, "/")}`,
        preferredInitMode: "direct",
      };
    });

    vi.doMock("@tauri-apps/api/core", () => ({
      isTauri: () => true,
    }));
    vi.doMock("../../../shared/api/local-resources", () => ({
      busytexCachePrepare: busytexCachePrepareMock,
    }));

    vi.resetModules();
    const { compileWithBusyTeX } = await import("./busytex");
    const result = await compileWithBusyTeX("\\begin{document}Hi\\end{document}", {}, "main.tex");

    expect(result.status).toBe("success");
    expect(busytexCachePrepareMock.mock.calls.map((call) => call[0])).toEqual([
      "install-first",
      "appdata-only",
    ]);
    expect(runnerInitCalls.some((call) => call.basePath.includes("good-cache"))).toBe(true);
  });

  it("retries once when worker returns unexpected token syntax error", async () => {
    mockCompilePayload = {
      success: true,
      pdf: [7, 8, 9],
      logs: [],
      exitCode: 0,
    };
    let cachePrepareCount = 0;

    runnerInitFailureResolver = (basePath) => {
      if (basePath.includes("good-cache")) {
        return null;
      }
      return "Worker error: Uncaught SyntaxError: Unexpected token <";
    };

    vi.doMock("@tauri-apps/api/core", () => ({
      isTauri: () => true,
    }));
    vi.doMock("../../../shared/api/local-resources", () => ({
      busytexCachePrepare: vi.fn(async () => {
        cachePrepareCount += 1;
        const dir = cachePrepareCount === 1 ? "F:\\bad-cache" : "F:\\good-cache";
        return {
          policy: "install-first",
          requestedDir: dir,
          actualDir: dir,
          installDirWritable: true,
          usingFallback: false,
          baseUrl: `http://asset.localhost/${dir.replace(/\\/g, "/")}`,
          preferredInitMode: "direct",
        };
      }),
    }));

    vi.resetModules();
    const { compileWithBusyTeX } = await import("./busytex");
    const result = await compileWithBusyTeX("\\begin{document}Hi\\end{document}", {}, "main.tex");

    expect(result.status).toBe("success");
    expect(cachePrepareCount).toBeGreaterThanOrEqual(2);
  });

  it("filters noisy busytex command logs and keeps actionable latex diagnostics", async () => {
    mockCompilePayload = {
      success: false,
      exitCode: 1,
      logs: {
        cmd: "xelatex --no-shell-escape --interaction=batchmode main.tex",
        log: "This is XeTeX, Version 3.141592653\n! LaTeX Error: File `ctex.sty' not found.\n! Emergency stop.\nl.10",
        stderr:
          "program exited (with status: 1), but keepRuntimeAlive() is set (counter=0) due to an async operation",
      },
    };

    vi.resetModules();
    const { compileWithBusyTeX } = await import("./busytex");
    const result = await compileWithBusyTeX("\\begin{document}Hi\\end{document}", {}, "main.tex");

    expect(result.status).toBe("error");
    expect(result.diagnostics.some((line) => /ctex\.sty/i.test(line))).toBe(true);
    expect(result.diagnostics.some((line) => /Emergency stop/i.test(line))).toBe(true);
    expect(result.diagnostics.some((line) => /xelatex --no-shell-escape/i.test(line))).toBe(false);
    expect(result.diagnostics.some((line) => /keepRuntimeAlive/i.test(line))).toBe(false);
  });
});
