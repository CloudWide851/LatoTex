type WorkerOk = { id: number; ok: true; result: unknown };
type WorkerErr = { id: number; ok: false; error: string };
type WorkerResponse = WorkerOk | WorkerErr;

type PendingTask = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
};

class PyodideRunner {
  private worker: Worker;
  private seq = 1;
  private pending = new Map<number, PendingTask>();

  constructor() {
    this.worker = new Worker(new URL("./analysisWorker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const payload = event.data;
      const task = this.pending.get(payload.id);
      if (!task) {
        return;
      }
      this.pending.delete(payload.id);
      clearTimeout(task.timer);
      if (payload.ok) {
        task.resolve(payload.result);
      } else {
        task.reject(new Error(payload.error));
      }
    };
  }

  runScript(script: string, timeoutMs = 45_000): Promise<unknown> {
    const id = this.seq++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Pyodide analysis timed out"));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({
        id,
        type: "run",
        script,
      });
    });
  }

  terminate() {
    for (const [, task] of this.pending) {
      clearTimeout(task.timer);
      task.reject(new Error("Pyodide runner terminated"));
    }
    this.pending.clear();
    this.worker.terminate();
  }
}

let singleton: PyodideRunner | null = null;

export function getPyodideRunner(): PyodideRunner {
  if (!singleton) {
    singleton = new PyodideRunner();
  }
  return singleton;
}

export function disposePyodideRunner() {
  if (!singleton) {
    return;
  }
  singleton.terminate();
  singleton = null;
}
