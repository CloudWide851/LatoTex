export type DrawAgentExportCommand = {
  sourcePath: string;
  format: string;
};

export type DrawAgentExportResult = {
  savedPath: string;
};

type PendingRequest = {
  command: DrawAgentExportCommand;
  resolve: (result: DrawAgentExportResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type ExportOwner = {
  sourcePath: string;
  execute: (command: DrawAgentExportCommand) => Promise<DrawAgentExportResult>;
};

let owner: ExportOwner | null = null;
let active = false;
const queue: PendingRequest[] = [];

function pumpQueue() {
  if (!owner || active) {
    return;
  }
  const index = queue.findIndex((item) => item.command.sourcePath === owner?.sourcePath);
  if (index < 0) {
    return;
  }
  const request = queue.splice(index, 1)[0];
  const currentOwner = owner;
  active = true;
  void currentOwner.execute(request.command)
    .then(request.resolve, request.reject)
    .finally(() => {
      clearTimeout(request.timer);
      active = false;
      queueMicrotask(pumpQueue);
    });
}

export function registerDrawAgentExportOwner(
  sourcePath: string,
  execute: ExportOwner["execute"],
): () => void {
  const registration = { sourcePath, execute };
  owner = registration;
  pumpQueue();
  return () => {
    if (owner === registration) {
      owner = null;
    }
  };
}

export function requestDrawAgentExport(command: DrawAgentExportCommand): Promise<DrawAgentExportResult> {
  return new Promise((resolve, reject) => {
    const request: PendingRequest = {
      command,
      resolve,
      reject,
      timer: setTimeout(() => {
        const index = queue.indexOf(request);
        if (index >= 0) {
          queue.splice(index, 1);
        }
        reject(new Error("research.ui_command.draw_owner_unavailable"));
      }, 30_000),
    };
    queue.push(request);
    pumpQueue();
  });
}
