import { Play, Square } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { Button } from "../../../components/ui/button";
import { markdownRunCode, markdownRunCodeCapabilities } from "../../../shared/api/workspace";
import type { MarkdownRunCodeCapability, MarkdownRunCodeResponse } from "../../../shared/types/app";

type RunState = {
  status: "idle" | "running" | "completed" | "failed";
  output?: MarkdownRunCodeResponse | null;
  error?: string | null;
};

const RUNNABLE = new Set(["javascript", "js", "typescript", "ts", "python", "py", "c", "cpp", "c++", "cc", "cxx", "go", "golang", "rust", "rs", "zig"]);

function languageFromClass(className?: string): string {
  return (className ?? "").split(/\s+/).find((item) => item.startsWith("language-"))?.replace("language-", "") ?? "";
}

function isJsLanguage(language: string): boolean {
  return ["javascript", "js", "typescript", "ts"].includes(language.toLowerCase());
}

function normalizeRunnable(language: string): string {
  const lower = language.toLowerCase();
  if (lower === "py") {
    return "python";
  }
  if (["c++", "cc", "cxx"].includes(lower)) {
    return "cpp";
  }
  if (lower === "js") {
    return "javascript";
  }
  if (lower === "ts") {
    return "typescript";
  }
  if (lower === "golang") {
    return "go";
  }
  if (lower === "rs") {
    return "rust";
  }
  return lower;
}

function runJavaScript(code: string): Promise<MarkdownRunCodeResponse> {
  const workerSource = `
    const lines = [];
    const console = {
      log: (...args) => lines.push(args.map(String).join(" ")),
      warn: (...args) => lines.push(args.map(String).join(" ")),
      error: (...args) => lines.push(args.map(String).join(" "))
    };
    self.fetch = undefined;
    self.XMLHttpRequest = undefined;
    self.WebSocket = undefined;
    self.importScripts = undefined;
    self.onmessage = async (event) => {
      const started = Date.now();
      try {
        const result = await (async () => {
          "use strict";
          ${code}
        })();
        if (typeof result !== "undefined") lines.push(String(result));
        self.postMessage({ status: "completed", stdout: lines.join("\\n"), stderr: "", exitCode: 0, durationMs: Date.now() - started });
      } catch (error) {
        self.postMessage({ status: "failed", stdout: lines.join("\\n"), stderr: String(error && error.stack ? error.stack : error), exitCode: 1, durationMs: Date.now() - started });
      }
    };
  `;
  const blobUrl = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
  return new Promise((resolve) => {
    const worker = new Worker(blobUrl);
    const timer = window.setTimeout(() => {
      worker.terminate();
      URL.revokeObjectURL(blobUrl);
      resolve({
        language: "javascript",
        status: "failed",
        stdout: "",
        stderr: "markdown.run.timeout",
        exitCode: null,
        durationMs: 8000,
        truncated: false,
        runner: "web-worker",
      });
    }, 8000);
    worker.onmessage = (event) => {
      window.clearTimeout(timer);
      worker.terminate();
      URL.revokeObjectURL(blobUrl);
      resolve({
        language: "javascript",
        status: event.data.status,
        stdout: String(event.data.stdout ?? "").slice(0, 32000),
        stderr: String(event.data.stderr ?? "").slice(0, 32000),
        exitCode: event.data.exitCode,
        durationMs: Number(event.data.durationMs ?? 0),
        truncated: String(event.data.stdout ?? "").length > 32000 || String(event.data.stderr ?? "").length > 32000,
        runner: "web-worker",
      });
    };
    worker.postMessage({});
  });
}

export function MarkdownPreviewPane(props: {
  activeProjectId: string | null;
  selectedPath: string | null;
  markdown: string;
  emptyText: string;
  t: (key: any) => string;
}) {
  const { activeProjectId, selectedPath, markdown, emptyText, t } = props;
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const [capabilities, setCapabilities] = useState<Record<string, MarkdownRunCodeCapability> | null>(null);
  const activeWorkerAbortRef = useRef<Record<string, boolean>>({});
  const content = useMemo(() => markdown, [markdown]);

  useEffect(() => {
    let active = true;
    void markdownRunCodeCapabilities()
      .then((items) => {
        if (!active) {
          return;
        }
        setCapabilities(Object.fromEntries(items.map((item) => [item.language, item])));
      })
      .catch(() => {
        if (active) {
          setCapabilities(null);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const runBlock = async (blockKey: string, language: string, code: string) => {
    const normalized = normalizeRunnable(language);
    setRuns((prev) => ({ ...prev, [blockKey]: { status: "running" } }));
    activeWorkerAbortRef.current[blockKey] = false;
    try {
      const output = isJsLanguage(normalized)
        ? await runJavaScript(code)
        : await markdownRunCode({
            projectId: activeProjectId ?? "",
            relativePath: selectedPath,
            language: normalized,
            code,
          });
      if (activeWorkerAbortRef.current[blockKey]) {
        return;
      }
      setRuns((prev) => ({
        ...prev,
        [blockKey]: { status: output.status === "completed" ? "completed" : "failed", output },
      }));
    } catch (error) {
      setRuns((prev) => ({ ...prev, [blockKey]: { status: "failed", error: String(error) } }));
    }
  };

  if (content.trim().length === 0) {
    return <p className="text-xs text-slate-500">{emptyText}</p>;
  }

  return (
    <article className="markdown-preview space-y-3 text-sm leading-6 text-slate-700">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeHighlight]}
        components={{
          a: ({ ...anchorProps }) => (
            <a {...anchorProps} target="_blank" rel="noreferrer noopener" className="text-primary-700 underline decoration-primary-400 underline-offset-2" />
          ),
          code: ({ inline, className, children, ...codeProps }: any) => {
            const code = String(children ?? "").replace(/\n$/, "");
            const language = normalizeRunnable(languageFromClass(className));
            const blockKey = `${language}:${code.slice(0, 80)}:${code.length}`;
            const capability = capabilities?.[language];
            const missingToolchain = !inline && RUNNABLE.has(language) && !isJsLanguage(language) && capabilities !== null && !capability?.available;
            const runnable = !inline && RUNNABLE.has(language) && !missingToolchain && (isJsLanguage(language) || Boolean(activeProjectId));
            const run = runs[blockKey] ?? { status: "idle" };
            if (inline) {
              return (
                <code {...codeProps} className={`rounded bg-slate-100 px-1 py-0.5 font-mono text-[12px] ${className ?? ""}`}>
                  {children}
                </code>
              );
            }
            return (
              <div className="markdown-code-block overflow-hidden rounded-md border">
                <div className="markdown-code-toolbar flex items-center justify-between border-b px-2 py-1">
                  <span className="text-[10px] uppercase tracking-[0.14em]">{language || "code"}</span>
                  {runnable || missingToolchain ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-7 px-2 text-[11px]"
                      disabled={missingToolchain}
                      title={missingToolchain ? t("preview.codeToolchainMissing") : undefined}
                      onClick={() => {
                        if (missingToolchain) {
                          return;
                        }
                        if (run.status === "running") {
                          activeWorkerAbortRef.current[blockKey] = true;
                          setRuns((prev) => ({ ...prev, [blockKey]: { status: "failed", error: t("preview.codeRunCancelled") } }));
                          return;
                        }
                        void runBlock(blockKey, language, code);
                      }}
                    >
                      {run.status === "running" ? <Square className="mr-1 h-3 w-3" /> : <Play className="mr-1 h-3 w-3" />}
                      {run.status === "running" ? t("preview.codeStop") : t("preview.codeRun")}
                    </Button>
                  ) : null}
                </div>
                <pre className="m-0 overflow-auto border-0 bg-transparent p-3"><code {...codeProps} className={`font-mono text-[12px] ${className ?? ""}`}>{children}</code></pre>
                {missingToolchain ? (
                  <div className="markdown-code-output border-t px-3 py-2 text-[11px] leading-5">
                    {t("preview.codeToolchainMissing")}
                  </div>
                ) : null}
                {run.status !== "idle" ? (
                  <div className="markdown-code-output border-t px-3 py-2 text-[11px] leading-5">
                    <div className="mb-1 flex items-center justify-between gap-2 opacity-75">
                      <span>{run.status === "running" ? t("preview.codeRunning") : t("preview.codeOutput")}</span>
                      {run.output ? (
                        <span className="truncate">
                          {t("preview.codeRunSummary")
                            .replace("{exitCode}", String(run.output.exitCode ?? "-"))
                            .replace("{duration}", String(run.output.durationMs))
                            .replace("{runner}", run.output.runner || "-")}
                        </span>
                      ) : null}
                    </div>
                    {run.error ? <pre className="whitespace-pre-wrap text-rose-600 dark:text-rose-300">{run.error}</pre> : null}
                    {run.output?.stdout ? <pre className="whitespace-pre-wrap">{run.output.stdout}</pre> : null}
                    {run.output && !run.output.stdout && !run.output.stderr && !run.error ? <div className="opacity-70">{t("preview.codeNoOutput")}</div> : null}
                    {run.output?.stderr ? <pre className="whitespace-pre-wrap text-amber-700 dark:text-amber-300">{run.output.stderr}</pre> : null}
                    {run.output?.truncated ? <div className="mt-1 text-amber-700 dark:text-amber-300">{t("preview.codeOutputTruncated")}</div> : null}
                  </div>
                ) : null}
              </div>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </article>
  );
}
