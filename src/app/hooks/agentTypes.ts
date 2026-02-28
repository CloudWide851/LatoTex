export type AgentMessageFormat = "plain" | "markdown";

export type AgentChatMessage = {
  id: string;
  role: "user" | "agent";
  text: string;
  format?: AgentMessageFormat;
  proposalId?: string;
};

export type AgentFileProposal = {
  id: string;
  targetPath: string;
  originalContent: string;
  candidateContent: string;
  summary: string;
  analysisPrompt: string;
  insertions?: number;
  deletions?: number;
  changedLines?: number[];
  diffBlocks?: AgentDiffBlock[];
  previewApplied?: boolean;
};

export type AgentDiffBlockKind = "add" | "delete" | "modify";

export type AgentDiffBlock = {
  kind: AgentDiffBlockKind;
  lineStart: number;
  lineEnd: number;
  insertions: number;
  deletions: number;
};

export type AgentEventCard = {
  id: string;
  runId: string;
  kind: string;
  stage: string;
  source: string;
  status: string;
  title: string;
  content: string;
  cardKey: string;
  createdAt: string;
};

export type AgentSessionSummary = {
  id: string;
  filePath: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
};

export type AgentRunRollback = {
  sessionId: string | null;
  prompt: string;
  messages: AgentChatMessage[];
};
