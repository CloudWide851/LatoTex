import type { TerminalFailure, TerminalStatus } from "../../../shared/types/app";

export type TerminalTab = {
  id: string;
  title: string;
  sequence: number;
  relativePath: string | null;
  sessionId: string | null;
  startRequestId: string | null;
  autoStart: boolean;
  cwd: string;
  venvPath: string | null;
  envSource: string | null;
  status: TerminalStatus;
  cursor: number;
  buffer: string;
  history?: string[];
  failure: TerminalFailure | null;
};

export type ProjectTerminalState = {
  tabs: TerminalTab[];
  activeTabId: string | null;
  railWidth: number;
};

export type TranslationFn = (key: any) => string;
