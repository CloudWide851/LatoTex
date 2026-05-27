export type TerminalTab = {
  id: string;
  title: string;
  relativePath: string | null;
  sessionId: string | null;
  cwd: string;
  venvPath: string | null;
  envSource: string | null;
  status: string;
  cursor: number;
  buffer: string;
  history?: string[];
  error: string | null;
};

export type ProjectTerminalState = {
  tabs: TerminalTab[];
  activeTabId: string | null;
};

export type TranslationFn = (key: any) => string;
