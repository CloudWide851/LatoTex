type RunMessage = {
  id: number;
  type: "run";
  script: string;
};

type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };

type PyodideInstance = {
  runPythonAsync: (code: string) => Promise<unknown>;
};

let pyodidePromise: Promise<PyodideInstance> | null = null;

async function loadPyodideInstance(): Promise<PyodideInstance> {
  if (pyodidePromise) {
    return pyodidePromise;
  }
  pyodidePromise = (async () => {
    const moduleUrl = "https://cdn.jsdelivr.net/pyodide/v0.27.2/full/pyodide.mjs";
    const module = await import(/* @vite-ignore */ moduleUrl);
    const pyodide = await module.loadPyodide({
      indexURL: "https://cdn.jsdelivr.net/pyodide/v0.27.2/full/",
    });
    return pyodide as PyodideInstance;
  })();
  return pyodidePromise;
}

function serializeResult(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value ?? {});
}

self.onmessage = async (event: MessageEvent<RunMessage>) => {
  const message = event.data;
  if (!message || message.type !== "run") {
    return;
  }
  try {
    const pyodide = await loadPyodideInstance();
    const wrappedScript = [
      "import json",
      "analysis_result = {}",
      message.script,
      "__latotex_output = json.dumps(analysis_result)",
      "__latotex_output",
    ].join("\n");
    const raw = await pyodide.runPythonAsync(wrappedScript);
    const text = serializeResult(raw);
    const result = text.trim().length > 0 ? JSON.parse(text) : {};
    const response: WorkerResponse = { id: message.id, ok: true, result };
    (self as unknown as Worker).postMessage(response);
  } catch (error) {
    const response: WorkerResponse = {
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    (self as unknown as Worker).postMessage(response);
  }
};
