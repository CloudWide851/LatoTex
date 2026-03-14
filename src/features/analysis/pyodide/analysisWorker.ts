export type PyodideSourceConfig = {
  moduleUrl: string;
  indexURL: string;
};

type InitMessage = {
  id: number;
  type: "init";
  source: PyodideSourceConfig;
};

type RunMessage = {
  id: number;
  type: "run";
  script: string;
  context?: Record<string, unknown>;
};

type WorkerMessage = InitMessage | RunMessage;

type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };

type PyodideInstance = {
  runPythonAsync: (code: string) => Promise<unknown>;
};

const DEFAULT_CDN_INDEX = "https://cdn.jsdelivr.net/pyodide/v0.27.2/full/";

let pyodidePromise: Promise<PyodideInstance> | null = null;
let pyodideSourceKey: string | null = null;
let activeSource: PyodideSourceConfig | null = null;

function sourceKey(source: PyodideSourceConfig): string {
  return `${source.moduleUrl}|${source.indexURL}`;
}

function encodeUtf8Base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }
  return btoa(binary);
}

async function loadPyodideInstance(source: PyodideSourceConfig): Promise<PyodideInstance> {
  const key = sourceKey(source);
  if (pyodidePromise && pyodideSourceKey === key) {
    return pyodidePromise;
  }

  pyodideSourceKey = key;
  activeSource = source;
  pyodidePromise = (async () => {
    const module = await import(/* @vite-ignore */ source.moduleUrl);
    const pyodide = await module.loadPyodide({
      indexURL: source.indexURL,
    });
    return pyodide as PyodideInstance;
  })();

  try {
    return await pyodidePromise;
  } catch (error) {
    pyodidePromise = null;
    pyodideSourceKey = null;
    activeSource = null;
    throw error;
  }
}

function serializeResult(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value ?? {});
}

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;
  if (!message) {
    return;
  }

  try {
    if (message.type === "init") {
      await loadPyodideInstance(message.source);
      const response: WorkerResponse = { id: message.id, ok: true, result: { initialized: true } };
      (self as unknown as Worker).postMessage(response);
      return;
    }

    if (message.type !== "run") {
      return;
    }

    const source = activeSource ?? {
      moduleUrl: `${DEFAULT_CDN_INDEX}pyodide.mjs`,
      indexURL: DEFAULT_CDN_INDEX,
    };
    const pyodide = await loadPyodideInstance(source);

    const contextBase64 = encodeUtf8Base64(JSON.stringify(message.context ?? {}));
    const wrappedScript = [
      "import base64",
      "import json",
      `analysis_context = json.loads(base64.b64decode('${contextBase64}').decode('utf-8'))`,
      "analysis_result = {}",
      message.script,
      "__latotex_output = json.dumps(analysis_result, ensure_ascii=False)",
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
