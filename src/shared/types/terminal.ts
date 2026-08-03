export type TerminalStatus =
  | "idle"
  | "starting"
  | "running"
  | "exited"
  | "failed"
  | "activating";

export type TerminalLaunchKind = "shell" | "codex-cli" | "claude-code-cli";

export type TerminalFailure = {
  code: string;
  stage: string;
  retryable: boolean;
};

export type TerminalStartResponse = {
  sessionId: string;
  cwd: string;
  shell: string;
  launchKind: TerminalLaunchKind;
  venvPath?: string | null;
  envSource?: string | null;
  status: TerminalStatus;
};

export type TerminalActivateResponse = {
  sessionId: string;
  venvPath: string;
  envSource: string;
  status: TerminalStatus;
};

export type TerminalOutputChunk = {
  seq: number;
  stream: "stdout" | "stderr" | string;
  text: string;
};

export type TerminalReadResponse = {
  cursor: number;
  chunks: TerminalOutputChunk[];
  exitCode?: number | null;
  status: TerminalStatus;
  failure?: TerminalFailure | null;
};
