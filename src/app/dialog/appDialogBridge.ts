export type AppDialogBridgeRequest =
  | {
      kind: "confirm";
      title: string;
      description?: string;
      details?: readonly string[];
      confirmLabel?: string;
      cancelLabel?: string;
      tone?: "default" | "danger" | "permission";
    }
  | {
      kind: "text-input";
      title: string;
      description?: string;
      label: string;
      initialValue?: string;
      placeholder?: string;
      confirmLabel?: string;
      cancelLabel?: string;
      required?: boolean;
    }
  | {
      kind: "choice";
      title: string;
      description?: string;
      choices: readonly {
        id: string;
        label: string;
        description?: string;
        tone?: "default" | "danger";
      }[];
      cancelLabel?: string;
      tone?: "default" | "danger" | "permission";
    };

export type AppDialogBridgeResult = boolean | string | null;

export type AppDialogBridgeEntry = {
  id: number;
  request: AppDialogBridgeRequest;
  settle: (result: AppDialogBridgeResult) => void;
};

type PendingEntry = AppDialogBridgeEntry & {
  resolve: (result: AppDialogBridgeResult) => void;
};

type HostListener = (entry: AppDialogBridgeEntry | null) => void;

let nextId = 1;
let hostListener: HostListener | null = null;
let activeEntry: PendingEntry | null = null;
const pendingEntries: PendingEntry[] = [];

function flushQueue() {
  if (!hostListener || activeEntry || pendingEntries.length === 0) {
    return;
  }
  activeEntry = pendingEntries.shift() ?? null;
  if (activeEntry) {
    hostListener(activeEntry);
  }
}

function settleEntry(id: number, result: AppDialogBridgeResult) {
  if (!activeEntry || activeEntry.id !== id) {
    return;
  }
  const completed = activeEntry;
  activeEntry = null;
  hostListener?.(null);
  completed.resolve(result);
  queueMicrotask(flushQueue);
}

export function registerAppDialogHost(listener: HostListener): () => void {
  hostListener = listener;
  flushQueue();
  return () => {
    if (hostListener !== listener) {
      return;
    }
    hostListener = null;
    if (activeEntry) {
      pendingEntries.unshift(activeEntry);
      activeEntry = null;
    }
  };
}

export function requestAppDialog(request: AppDialogBridgeRequest): Promise<AppDialogBridgeResult> {
  return new Promise((resolve) => {
    const id = nextId;
    nextId += 1;
    pendingEntries.push({
      id,
      request,
      resolve,
      settle: (result) => settleEntry(id, result),
    });
    flushQueue();
  });
}

export async function requestAppConfirm(
  request: Omit<Extract<AppDialogBridgeRequest, { kind: "confirm" }>, "kind">,
): Promise<boolean> {
  return (await requestAppDialog({ kind: "confirm", ...request })) === true;
}

export async function requestAppTextInput(
  request: Omit<Extract<AppDialogBridgeRequest, { kind: "text-input" }>, "kind">,
): Promise<string | null> {
  const result = await requestAppDialog({ kind: "text-input", ...request });
  return typeof result === "string" ? result : null;
}

export async function requestAppChoice(
  request: Omit<Extract<AppDialogBridgeRequest, { kind: "choice" }>, "kind">,
): Promise<string | null> {
  const result = await requestAppDialog({ kind: "choice", ...request });
  return typeof result === "string" ? result : null;
}
